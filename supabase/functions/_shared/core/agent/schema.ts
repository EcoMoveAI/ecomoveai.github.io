/**
 * Minimal JSON-Schema subset used both as the LLM tool `input_schema` and for server-side argument
 * validation. Supported keywords: type, properties, required, additionalProperties:false, enum,
 * minimum, maximum, minLength, maxLength, pattern, items, minItems, maxItems, description.
 */
export type JsonSchema =
  | { type: 'object'; properties: Record<string, JsonSchema>; required?: string[]; additionalProperties?: false; description?: string }
  | { type: 'string'; enum?: readonly string[]; minLength?: number; maxLength?: number; pattern?: string; description?: string }
  | { type: 'number' | 'integer'; minimum?: number; maximum?: number; description?: string }
  | { type: 'boolean'; description?: string }
  | { type: 'array'; items: JsonSchema; minItems?: number; maxItems?: number; description?: string };

export function validateAgainstSchema(value: unknown, schema: JsonSchema, path = 'input'): string[] {
  const errors: string[] = [];
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${path} must be an object.`];
      const obj = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (obj[key] === undefined || obj[key] === null) errors.push(`${path}.${key} is required.`);
      }
      for (const [key, v] of Object.entries(obj)) {
        const prop = schema.properties[key];
        if (!prop) {
          if (schema.additionalProperties === false) errors.push(`${path}.${key} is not an allowed property.`);
          continue;
        }
        if (v === undefined || v === null) continue;
        errors.push(...validateAgainstSchema(v, prop, `${path}.${key}`));
      }
      return errors;
    }
    case 'string': {
      if (typeof value !== 'string') return [`${path} must be a string.`];
      if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of: ${schema.enum.join(', ')}.`);
      if (schema.minLength != null && value.length < schema.minLength) errors.push(`${path} is too short.`);
      if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${path} must be at most ${schema.maxLength} characters.`);
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path} has an invalid format.`);
      return errors;
    }
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return [`${path} must be a number.`];
      if (schema.type === 'integer' && !Number.isInteger(value)) errors.push(`${path} must be an integer.`);
      if (schema.minimum != null && value < schema.minimum) errors.push(`${path} must be ≥ ${schema.minimum}.`);
      if (schema.maximum != null && value > schema.maximum) errors.push(`${path} must be ≤ ${schema.maximum}.`);
      return errors;
    }
    case 'boolean':
      return typeof value === 'boolean' ? [] : [`${path} must be true or false.`];
    case 'array': {
      if (!Array.isArray(value)) return [`${path} must be an array.`];
      if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path} needs at least ${schema.minItems} item(s).`);
      if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path} allows at most ${schema.maxItems} item(s).`);
      value.forEach((v, i) => errors.push(...validateAgainstSchema(v, schema.items, `${path}[${i}]`)));
      return errors;
    }
  }
}
