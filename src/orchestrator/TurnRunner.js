import fs from 'node:fs';
import path from 'node:path';
import { buildPrompt, SILENT_MARKER } from '../llm/promptBuilder.js';
import { interpolateTag } from '../visibility/tags.js';
import * as Policy from '../visibility/Policy.js';
import * as ContextAssembler from '../visibility/ContextAssembler.js';
import { maybeSummarize } from '../agents/memory/MemoryManager.js';
import { runStateExtraction, applyStateExtraction } from '../agents/state/stateExtractionRunner.js';

export class TurnRunner {
  constructor({
    store,
    llmClient,
    utilityLlmClient = null,
    agentRegistry,
    worldDir,
    locationRegistry = null,
    summarizeEveryNTurns = 0,
    summaryWords = 200,
    applyTurnLocation = true,
  }) {
    this.store = store;
    this.llmClient = llmClient;
    this.utilityLlmClient = utilityLlmClient;
    this.agentRegistry = agentRegistry;
    this.worldDir = worldDir;
    this.locationRegistry = locationRegistry;
    this.summarizeEveryNTurns = summarizeEveryNTurns;
    this.summaryWords = summaryWords;
    // When false, this turn's own state extraction still tracks mood/action/relationships but does
    // NOT write location — the holistic scene-location skill owns location on the interactive path.
    // Default true keeps the CLI batch loop's per-agent location tracking unchanged.
    this.applyTurnLocation = applyTurnLocation;
    // Per-agent background queue for state-extraction/summarization (see runTurn) — deliberately
    // keyed by agentId, not a single shared queue: different agents' background work is fully
    // independent (each only reads/writes its own facts) and must NOT wait on each other, only a
    // given agent's own back-to-back background tasks need to stay in order.
    this._backgroundQueues = new Map();
  }

  /** Chains background jobs for one agent so they never run concurrently with each other; a
   * failed job is logged (never thrown) so it can't take down an unrelated later turn. */
  _enqueueBackground(agentId, job) {
    const prev = this._backgroundQueues.get(agentId) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(job).catch((err) => {
      console.error(`[TurnRunner] background state-extraction/summarize failed for ${agentId}:`, err);
    });
    this._backgroundQueues.set(agentId, next);
    return next;
  }

  /**
   * onToken/llmClient/utilityLlmClient are additive: the CLI/batch SimulationLoop never passes
   * them, so behavior there is unchanged. The interactive server passes all three — onToken to
   * stream deltas out over WS, llmClient/utilityLlmClient to use whichever providers are currently
   * active rather than the ones this TurnRunner was constructed with. utilClient falls all the way
   * back to the dialogue client when nothing else is configured, so a single-provider setup (CLI,
   * or a fresh server install) never needs a second provider just to keep working.
   */
  async runTurn(agentId, {
    onToken, llmClient, utilityLlmClient, resolveName, roster, witnessIds = [],
    extraTags = [], eventData = undefined, eventTs = undefined,
  } = {}) {
    const client = llmClient ?? this.llmClient;
    const utilClient = utilityLlmClient ?? this.utilityLlmClient ?? client;
    // Turn actor ids into display names for every prompt so ids never surface in model output.
    // The interactive server passes a persona-aware resolver; the default here covers agents only.
    const nameOf = resolveName ?? ((id) => {
      try {
        return this.agentRegistry?.loadProfile(id)?.name ?? id;
      } catch {
        return id;
      }
    });
    const profile = this.agentRegistry.loadProfile(agentId);
    const policy = Policy.resolve(agentId, profile, this.store);
    const context = ContextAssembler.assemble({ agentId, profile, store: this.store, policy, limit: 30 });
    const turnId = this.store.startTurn(agentId, this.store.peekNextSeq());
    // Ground the prompt in where this agent's own location fact actually says they are right now
    // — independent of which turn owns writing that fact (see applyTurnLocation) — so the model
    // never narrates or reacts as though it were somewhere else.
    const locationId = context.stateSnapshot.location;
    const resolveLocationName = (id) => this.locationRegistry?.get(id)?.name ?? id;
    const locationName = locationId ? resolveLocationName(locationId) : null;

    try {
      const { system, messages } = buildPrompt({
        profile,
        agentId,
        recentEvents: context.visibleEvents,
        memorySummary: context.memorySummary,
        resolveName: nameOf,
        resolveLocationName,
        roster,
        locationName,
      });
      // Opt-in, for debugging what actually goes to the model — set DEBUG_PROMPTS=1 to enable.
      // Deliberately just a console log, not a stored event: this is a dev tool, not game state.
      if (process.env.DEBUG_PROMPTS) {
        const rendered = messages.map((m) => `--- ${m.role} ---\n${m.content}`).join('\n');
        console.log(`\n===== [prompt] ${agentId} =====\nSYSTEM:\n${system}\n\nMESSAGES:\n${rendered}\n===== end [prompt] ${agentId} =====\n`);
      }
      const rawText = await client.chatCompletion({ system, messages, onToken });
      const dialogueText = rawText.trim();

      // The agent decided it has nothing to say/do this turn (see groupSceneInstruction in
      // promptBuilder.js). Skip state extraction, persistence, and summarization entirely — there's
      // no new dialogue/action for any of those to reason about, and the caller (RoomManager) must
      // not broadcast or collect this as a spoken turn.
      if (dialogueText === SILENT_MARKER) {
        this.store.endTurn(turnId, 'ok');
        return { silent: true, dialogueText: null, rawText, updates: [], parseError: null, stateUpdate: null, summarized: false };
      }

      // Foreground path ends here: the dialogue line itself — the only thing the NEXT agent's turn
      // (or _concludeScene) actually needs — is committed synchronously, in order, same as before.
      // witnessIds gets each present witness (player + other agents) their own private:<id> tag on
      // this event, so it stays in THEIR memory permanently regardless of where they later move to
      // (see RoomManager._runScene's witnessIds and promptBuilder.js's scene-change markers).
      const tagCtx = { self: agentId, state: context.stateSnapshot };
      const dialogueTags = [
        interpolateTag('local:{state.location}', tagCtx),
        interpolateTag('private:{self}', tagCtx),
        ...witnessIds.filter((id) => id !== agentId).map((id) => `private:${id}`),
        ...extraTags,
      ].filter(Boolean);

      const dialogueEvent = this.store.append(
        {
          type: 'dialogue', actor: agentId, subject: agentId, content: dialogueText,
          data: eventData, ts: eventTs, turnId,
        },
        dialogueTags,
      );

      // Background: state extraction (mood/action/relationship/addressedTo), persistence,
      // memory summarization. Deliberately NOT awaited — nothing else this round depends on it (see
      // the plan doc's Tier-2 reasoning: ContextAssembler only ever reads an agent's OWN facts, and
      // location is owned elsewhere on this path), so the next agent can start immediately and
      // scene_done doesn't wait on it either. Queued per-agent (_enqueueBackground) purely to stop
      // this SAME agent's own back-to-back background work from racing itself; different agents'
      // background work runs fully concurrently, never queued behind each other.
      const backgroundTask = this._enqueueBackground(agentId, () =>
        this._finishTurnInBackground({
          agentId,
          turnId,
          profile,
          policy,
          context,
          dialogueText,
          dialogueEventId: dialogueEvent.id,
          dialogueTags,
          utilClient,
          resolveName: nameOf,
        }),
      );

      return {
        dialogueText,
        rawText,
        updates: [],
        parseError: null,
        stateUpdate: null,
        summarized: false,
        // Not consumed by the live loop (RoomManager doesn't await this) — exposed so tests/callers
        // that need to observe the eventually-persisted facts can `await result.backgroundTask`.
        backgroundTask,
      };
    } catch (err) {
      this.store.endTurn(turnId, 'error');
      throw err;
    }
  }

  /**
   * Everything about this turn that no other turn in this round depends on: state extraction,
   * persisting the derived facts + addressedTo, closing out the turn, and periodic summarization.
   * Runs after the dialogue event is already committed (see runTurn) — a failure here never loses
   * or retroactively invalidates the dialogue that already went out.
   */
  async _finishTurnInBackground({ agentId, turnId, profile, policy, context, dialogueText, dialogueEventId, dialogueTags, utilClient, resolveName }) {
    const stateResult = await runStateExtraction({
      utilClient,
      profile,
      subjectId: agentId,
      recentEvents: context.visibleEvents,
      dialogueText,
      locationRegistry: this.locationRegistry,
      resolveName,
      stateSnapshot: context.stateSnapshot,
    });

    let lastEventId = dialogueEventId;
    this.store.db.transaction(() => {
      if (stateResult.addressedTo) {
        const addressedEvent = this.store.append(
          { type: 'fact', actor: agentId, subject: agentId, key: 'addressedTo', content: stateResult.addressedTo, turnId },
          dialogueTags,
        );
        lastEventId = addressedEvent.id;
      }

      const applied = applyStateExtraction({
        store: this.store,
        subjectId: agentId,
        stateResult,
        locationRegistry: this.locationRegistry,
        turnId,
        applyLocation: this.applyTurnLocation,
      });
      if (applied.lastEventId) lastEventId = applied.lastEventId;

      this.store.advanceCursor(agentId, lastEventId);
    })();

    this.store.endTurn(turnId, stateResult.parseError ? 'ok_with_parse_error' : 'ok');
    this._materializeState(agentId);

    const summaryEvent = await maybeSummarize({
      agentId,
      store: this.store,
      llmClient: utilClient,
      policy,
      everyNTurns: this.summarizeEveryNTurns,
      words: this.summaryWords,
      resolveName,
    });
    if (summaryEvent) this._materializeMemory(agentId);

    return { stateResult, summarized: Boolean(summaryEvent) };
  }

  _materializeState(agentId) {
    const facts = this.store.getFactsForSubject(agentId);
    const state = {};
    for (const fact of facts) {
      state[fact.key] = fact.data ?? fact.content;
    }
    const outPath = path.join(this.worldDir, 'agents', agentId, 'state.json');
    fs.writeFileSync(outPath, JSON.stringify(state, null, 2));
  }

  _materializeMemory(agentId) {
    const memory = this.store.getLatestMemory(agentId);
    const outPath = path.join(this.worldDir, 'agents', agentId, 'memory.md');
    fs.writeFileSync(outPath, memory?.content ?? '');
  }
}
