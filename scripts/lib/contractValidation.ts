/**
 * API contract tooling (FC 027 Q03, T2.2, ADR 0014): turns the route registry
 * (apps/api/src/contract.ts) into an OpenAPI 3.1 document, and finds the changes between two
 * documents that would break a client already in the field.
 *
 * Breaking means: an operation, a parameter or an answer status disappears; a request starts
 * requiring something new or accepts less (narrower type, enum, bounds or pattern); an answer
 * drops or loosens a property a client reads (removed, no longer required, new type, new enum
 * value, becomes nullable). Adding optional inputs, new operations, new answer properties or
 * wider request bounds is compatible. Pure: the CLI is scripts/checkApiContract.ts.
 *
 * @module
 */
import { z } from 'zod';

/** A JSON Schema node, as `z.toJSONSchema` writes it. */
export interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  [keyword: string]: unknown;
}

/** One OpenAPI parameter. */
interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  schema: JsonSchema;
}

/** One OpenAPI operation, as this tool writes it. */
interface Operation {
  summary: string;
  'x-permission': string;
  parameters: Parameter[];
  requestBody?: {
    required: true;
    content: Record<string, { schema: JsonSchema }>;
  };
  responses: Record<
    string,
    { description: string; content: Record<string, { schema: JsonSchema }> }
  >;
}

/** The OpenAPI 3.1 document of the API. */
export interface OpenApiDocument {
  openapi: '3.1.0';
  info: { title: string; version: string };
  paths: Record<string, Record<string, Operation>>;
}

/** The part of a route contract this tool reads (apps/api/src/contract.ts). */
export interface ContractEntry {
  method: string;
  path: string;
  summary: string;
  permission: string;
  request: {
    params?: z.ZodType;
    query?: z.ZodType;
    headers?: z.ZodType;
    body?: z.ZodType;
    rawBody?: true;
  };
  responses: Readonly<Record<number, z.ZodType>>;
}

const PROBLEM_JSON = 'application/problem+json';

const REASONS: Readonly<Record<number, string>> = {
  200: 'OK',
  201: 'Created',
  400: 'Bad Request',
  401: 'Unauthorized',
  404: 'Not Found',
  409: 'Conflict',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

/** JSON Schema of a Zod schema, without the `$schema` header nested documents must not carry. */
function jsonSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  const node = z.toJSONSchema(schema, {
    io,
    unrepresentable: 'any',
  }) as JsonSchema;
  delete node.$schema;
  return node;
}

/** OpenAPI parameters of one object schema (path, query or headers). */
function parameters(
  schema: z.ZodType | undefined,
  location: Parameter['in']
): Parameter[] {
  if (schema === undefined) return [];
  const { properties = {}, required = [] } = jsonSchema(schema, 'input');
  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: location,
    required: location === 'path' || required.includes(name),
    schema: property,
  }));
}

/** OpenAPI operation of one route. */
function operation(route: ContractEntry, problem: z.ZodType): Operation {
  const { request } = route;
  const body = request.body
    ? { 'application/json': { schema: jsonSchema(request.body, 'input') } }
    : { 'application/json': { schema: {} } };
  return {
    summary: route.summary,
    'x-permission': route.permission,
    parameters: [
      ...parameters(request.params, 'path'),
      ...parameters(request.query, 'query'),
      ...parameters(request.headers, 'header'),
    ],
    ...((request.body ?? request.rawBody) && {
      requestBody: { required: true as const, content: body },
    }),
    responses: Object.fromEntries(
      Object.entries(route.responses).map(([status, schema]) => [
        status,
        {
          description: REASONS[Number(status)] ?? 'Answer',
          content: {
            [schema === problem ? PROBLEM_JSON : 'application/json']: {
              schema: jsonSchema(schema, 'output'),
            },
          },
        },
      ])
    ),
  };
}

/**
 * Builds the OpenAPI 3.1 document of a route registry.
 *
 * @param routes - The registry, in order.
 * @param problem - The RFC 7807 schema, so its answers get `application/problem+json`.
 * @param info - Title and contract version (the API major, not the package version).
 * @returns The document; paths use OpenAPI `{param}` syntax.
 */
export function buildOpenApi(
  routes: readonly ContractEntry[],
  problem: z.ZodType,
  info: OpenApiDocument['info']
): OpenApiDocument {
  const paths: OpenApiDocument['paths'] = {};
  for (const route of routes) {
    const path = route.path.replace(/:(\w+)/g, '{$1}');
    paths[path] ??= {};
    paths[path][route.method.toLowerCase()] = operation(route, problem);
  }
  return { openapi: '3.1.0', info, paths };
}

/** Which side of the wire a schema describes. */
type Side = 'request' | 'response';

/** The types a node admits, `null` included when it is nullable. */
function typesOf(node: JsonSchema): Set<string> {
  if (node.anyOf) return new Set(node.anyOf.flatMap((n) => [...typesOf(n)]));
  if (node.type === undefined) return new Set(['any']);
  return new Set(Array.isArray(node.type) ? node.type : [node.type]);
}

const isSubset = (small: Set<string>, big: Set<string>) =>
  big.has('any') || [...small].every((value) => big.has(value));

/** Type and enum changes: a request may only widen, an answer may only narrow. */
function typeChanges(
  before: JsonSchema,
  after: JsonSchema,
  side: Side,
  at: string
): string[] {
  const [was, now] = [typesOf(before), typesOf(after)];
  const compatible =
    side === 'request' ? isSubset(was, now) : isSubset(now, was);
  const changes = compatible
    ? []
    : [`${at}: type ${[...was].join('|')} → ${[...now].join('|')}`];
  if (before.enum && after.enum) {
    const [old, next] = [new Set(before.enum), new Set(after.enum)];
    const lost = [...(side === 'request' ? old : next)].filter(
      (value) => !(side === 'request' ? next : old).has(value)
    );
    if (lost.length > 0)
      changes.push(
        `${at}: enum ${side === 'request' ? 'drops' : 'adds'} ${lost.join(', ')}`
      );
  }
  return changes;
}

const LOWER_BOUNDS = ['minimum', 'minLength', 'minItems'] as const;
const UPPER_BOUNDS = ['maximum', 'maxLength', 'maxItems'] as const;

/** Bounds and pattern of a request: raising a minimum or lowering a maximum rejects old input. */
function boundChanges(
  before: JsonSchema,
  after: JsonSchema,
  at: string
): string[] {
  const changes: string[] = [];
  for (const key of LOWER_BOUNDS) {
    if ((after[key] ?? -Infinity) > (before[key] ?? -Infinity))
      changes.push(`${at}: ${key} raised to ${after[key]}`);
  }
  for (const key of UPPER_BOUNDS) {
    if ((after[key] ?? Infinity) < (before[key] ?? Infinity))
      changes.push(`${at}: ${key} lowered to ${after[key]}`);
  }
  if (after.pattern !== undefined && after.pattern !== before.pattern)
    changes.push(`${at}: pattern changed`);
  return changes;
}

/** Property changes of an object, recursively. */
function propertyChanges(
  before: JsonSchema,
  after: JsonSchema,
  side: Side,
  at: string
): string[] {
  const changes: string[] = [];
  const [was, now] = [before.properties ?? {}, after.properties ?? {}];
  const [wasRequired, nowRequired] = [
    new Set(before.required),
    new Set(after.required),
  ];
  for (const [name, node] of Object.entries(was)) {
    const next = now[name];
    if (next === undefined) changes.push(`${at}.${name}: removed`);
    else changes.push(...schemaChanges(node, next, side, `${at}.${name}`));
  }
  for (const name of Object.keys(now)) {
    const breaks =
      side === 'request'
        ? nowRequired.has(name) && !wasRequired.has(name)
        : wasRequired.has(name) && !nowRequired.has(name) && name in was;
    if (breaks)
      changes.push(
        `${at}.${name}: ${side === 'request' ? 'now required' : 'no longer always present'}`
      );
  }
  return changes;
}

/**
 * Breaking changes between two versions of one schema.
 *
 * @param before - Schema in the published contract.
 * @param after - Schema in the new contract.
 * @param side - `request` when clients send it, `response` when they read it.
 * @param at - Location for the messages.
 * @returns One message per breaking change; empty when compatible.
 */
export function schemaChanges(
  before: JsonSchema,
  after: JsonSchema,
  side: Side,
  at: string
): string[] {
  return [
    ...typeChanges(before, after, side, at),
    ...(side === 'request' ? boundChanges(before, after, at) : []),
    ...propertyChanges(before, after, side, at),
    ...(before.items && after.items
      ? schemaChanges(before.items, after.items, side, `${at}[]`)
      : []),
  ];
}

/** Changes of the parameters: removed, narrowed, or newly required. */
function parameterChanges(
  before: Operation,
  after: Operation,
  at: string
): string[] {
  const changes: string[] = [];
  const key = (p: Parameter) => `${p.in}:${p.name}`;
  const next = new Map(after.parameters.map((p) => [key(p), p]));
  for (const parameter of before.parameters) {
    const now = next.get(key(parameter));
    const where = `${at} ${parameter.in} ${parameter.name}`;
    if (now === undefined) changes.push(`${where}: removed`);
    else
      changes.push(
        ...schemaChanges(parameter.schema, now.schema, 'request', where)
      );
  }
  const old = new Set(before.parameters.map(key));
  for (const parameter of after.parameters) {
    if (parameter.required && !old.has(key(parameter)))
      changes.push(
        `${at} ${parameter.in} ${parameter.name}: new required parameter`
      );
  }
  return changes;
}

/** Changes of each schema a media-type map holds (a request body or one answer). */
function contentChanges(
  before: Record<string, { schema: JsonSchema }>,
  after: Record<string, { schema: JsonSchema }> | undefined,
  side: Side,
  at: string
): string[] {
  return Object.entries(before).flatMap(([mime, { schema }]) => {
    const now = after?.[mime]?.schema;
    return now === undefined
      ? [`${at} ${mime}: removed`]
      : schemaChanges(schema, now, side, at);
  });
}

/** Breaking changes of one operation that exists in both documents. */
function operationChanges(
  before: Operation,
  after: Operation,
  at: string
): string[] {
  return [
    ...parameterChanges(before, after, at),
    ...contentChanges(
      before.requestBody?.content ?? {},
      after.requestBody?.content,
      'request',
      `${at} body`
    ),
    ...Object.entries(before.responses).flatMap(([status, answer]) =>
      contentChanges(
        answer.content,
        after.responses[status]?.content,
        'response',
        `${at} ${status}`
      )
    ),
  ];
}

/**
 * Breaking changes from a published contract to a new one (T2.2).
 *
 * @param before - The committed document (apps/api/openapi.json).
 * @param after - The document built from the registry now.
 * @returns One message per breaking change; empty when every client keeps working.
 */
export function breakingChanges(
  before: OpenApiDocument,
  after: OpenApiDocument
): string[] {
  const changes: string[] = [];
  for (const [path, methods] of Object.entries(before.paths)) {
    for (const [method, operationBefore] of Object.entries(methods)) {
      const at = `${method.toUpperCase()} ${path}`;
      const operationAfter = after.paths[path]?.[method];
      if (operationAfter === undefined) changes.push(`${at}: removed`);
      else
        changes.push(...operationChanges(operationBefore, operationAfter, at));
    }
  }
  return changes;
}
