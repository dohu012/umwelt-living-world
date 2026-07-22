import { buildVisualCardPrompt, parseVisualCard } from './visualCardExtractor.js';

/**
 * Runs the visual-card sub-agent: one silent utility LLM call that turns a character sheet plus the
 * round's transcript into the CharacterCard / SceneCard that scene-image's prompt builders consume.
 *
 * Never throws — a network or parse failure returns `{character: null, scene: null}`, and callers
 * treat a null card as "let the Python heuristics summarizer handle it", so a flaky utility
 * provider degrades image quality instead of breaking image generation outright.
 */
export async function runVisualCardExtraction({
  utilClient,
  needCharacter = false,
  needScene = false,
  transcript = '',
  profile = null,
  state = null,
  locationName = '',
  knownCharacter = null,
  knownScene = null,
}) {
  if (!utilClient || (!needCharacter && !needScene)) return { character: null, scene: null };

  try {
    const { system, messages } = buildVisualCardPrompt({
      needCharacter,
      needScene,
      transcript,
      profile,
      state,
      locationName,
      knownCharacter,
      knownScene,
    });
    // Do not impose a token budget here — same trap the state extractor documents: a
    // reasoning-capable provider (StepFun step-3.7-flash) spends the whole allowance on hidden
    // chain-of-thought and returns empty content, which would silently degrade every portrait to
    // the fallback card. Let the utility provider's own maxTokens setting govern.
    const rawText = await utilClient.chatCompletion({ system, messages });
    const parsed = parseVisualCard(rawText);
    return {
      character: needCharacter ? parsed.character : null,
      scene: needScene ? parsed.scene : null,
    };
  } catch {
    return { character: null, scene: null };
  }
}
