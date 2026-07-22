import Ajv from 'ajv';

const ajv = new Ajv();

/** V2 character-card fields, reused 1:1 per the plan. */
export const profileSchema = {
  type: 'object',
  required: ['name', 'description'],
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    personality: { type: 'string' },
    scenario: { type: 'string' },
    first_mes: { type: 'string' },
    mes_example: { type: 'string' },
    creator_notes: { type: 'string' },
    system_prompt: { type: 'string' },
    post_history_instructions: { type: 'string' },
    alternate_greetings: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
    creator: { type: 'string' },
    character_version: { type: 'string' },
    avatar: { type: 'string' }, // relative filename within the agent's own dir, e.g. "avatar.png"
    extensions: { type: 'object' },
  },
};

export const validateProfile = ajv.compile(profileSchema);
