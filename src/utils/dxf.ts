import type { PathEntity, PathKind, Vec2 } from '../types';

interface RawDXFEntity {
  points: Vec2[];
  closed: boolean;
  layer?: string;
}

interface ParsedDXFShape {
  points: Vec2[];
  closed: boolean;
  kind: PathKind;
}

const WORKSPACE_SIZE = 50;
const WORKSPACE_CENTER = { x: WORKSPACE_SIZE / 2, y: WORKSPACE_SIZE / 2 } as const;

const parseNumber = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '0';
  }
  const fixed = value.toFixed(6);
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1');
};

const buildTokens = (content: string): Array<{ code: number; value: string }> => {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const tokens: Array<{ code: number; value: string }> = [];
  for (let i = 0; i < lines.length; ) {
    const rawCode = lines[i]?.trim();
    i += 1;
    if (!rawCode) {
      continue;
    }
    const code = Number.parseInt(rawCode, 10);
    if (!Number.isFinite(code)) {
      continue;
    }
    const rawValue = lines[i] ?? '';
    i += 1;
    tokens.push({ code, value: rawValue.trim() });
  }
  return tokens;
};

const centerEntities = (entities: RawDXFEntity[]): RawDXFEntity[] => {
  const allPoints = entities.flatMap((entity) => entity.points);
  if (!allPoints.length) {
    return entities;
  }
  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const maxY = Math.max(...allPoints.map((point) => point.y));
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const offset = { x: WORKSPACE_CENTER.x - center.x, y: WORKSPACE_CENTER.y - center.y };
  return entities.map((entity) => ({
    ...entity,
    points: entity.points.map((point) => ({ x: point.x + offset.x, y: point.y + offset.y })),
  }));
};

const parseLineEntity = (
  tokens: Array<{ code: number; value: string }>,
  startIndex: number,
): { entity: RawDXFEntity | null; nextIndex: number } => {
  let startX: number | null = null;
  let startY: number | null = null;
  let endX: number | null = null;
  let endY: number | null = null;
  let layer: string | undefined;
  let index = startIndex;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.code === 0) break;
    switch (token.code) {
      case 8:
        layer = token.value.trim();
        break;
      case 10:
        startX = parseNumber(token.value);
        break;
      case 20:
        startY = parseNumber(token.value);
        break;
      case 11:
        endX = parseNumber(token.value);
        break;
      case 21:
        endY = parseNumber(token.value);
        break;
      default:
        break;
    }
    index += 1;
  }
  if (startX === null || startY === null || endX === null || endY === null) {
    return { entity: null, nextIndex: index };
  }
  return {
    entity: {
      points: [
        { x: startX, y: startY },
        { x: endX, y: endY },
      ],
      closed: false,
      layer,
    },
    nextIndex: index,
  };
};

const parseLwpolylineEntity = (
  tokens: Array<{ code: number; value: string }>,
  startIndex: number,
): { entity: RawDXFEntity | null; nextIndex: number } => {
  const points: Vec2[] = [];
  let currentX: number | null = null;
  let closed = false;
  let layer: string | undefined;
  let index = startIndex;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.code === 0) break;
    switch (token.code) {
      case 8:
        layer = token.value.trim();
        break;
      case 70: {
        const flag = Number.parseInt(token.value, 10);
        if (Number.isFinite(flag)) {
          closed = (flag & 1) === 1;
        }
        break;
      }
      case 10:
        currentX = parseNumber(token.value);
        break;
      case 20:
        if (currentX !== null) {
          points.push({ x: currentX, y: parseNumber(token.value) });
          currentX = null;
        }
        break;
      default:
        break;
    }
    index += 1;
  }
  if (closed && points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= 1e-6) {
      points.pop();
    }
  }
  if (points.length < 2) {
    return { entity: null, nextIndex: index };
  }
  return {
    entity: {
      points,
      closed,
      layer,
    },
    nextIndex: index,
  };
};

const parseEntities = (tokens: Array<{ code: number; value: string }>): RawDXFEntity[] => {
  const entities: RawDXFEntity[] = [];
  let inEntities = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.code !== 0) {
      continue;
    }
    const type = token.value.toUpperCase();
    if (type === 'SECTION') {
      const next = tokens[i + 1];
      if (next && next.code === 2 && next.value.toUpperCase() === 'ENTITIES') {
        inEntities = true;
      }
      continue;
    }
    if (type === 'ENDSEC') {
      inEntities = false;
      continue;
    }
    if (!inEntities) {
      continue;
    }
    if (type === 'EOF') {
      break;
    }
    if (type === 'LINE') {
      const { entity, nextIndex } = parseLineEntity(tokens, i + 1);
      if (entity) {
        entities.push(entity);
      }
      if (nextIndex > i) {
        i = nextIndex - 1;
      }
      continue;
    }
    if (type === 'LWPOLYLINE') {
      const { entity, nextIndex } = parseLwpolylineEntity(tokens, i + 1);
      if (entity) {
        entities.push(entity);
      }
      if (nextIndex > i) {
        i = nextIndex - 1;
      }
    }
  }
  return entities;
};

export const parseDXFShapes = (content: string): ParsedDXFShape[] => {
  const tokens = buildTokens(content);
  const entities = centerEntities(parseEntities(tokens));
  return entities.map((entity) => ({
    points: entity.points.map((point) => ({ ...point })),
    closed: entity.closed,
    kind: entity.layer?.toLowerCase() === 'reference' ? 'reference' : 'oxided',
  }));
};

export const serializePathsToDXF = (paths: PathEntity[]): string => {
  const lines: string[] = [
    '0',
    'SECTION',
    '2',
    'HEADER',
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'ENTITIES',
  ];

  paths.forEach((path) => {
    const points = path.nodes.map((node) => node.point);
    if (points.length < 2) {
      return;
    }
    const layer = path.meta.kind === 'reference' ? 'REFERENCE' : 'OXIDED';
    if (!path.meta.closed && points.length === 2) {
      lines.push(
        '0',
        'LINE',
        '8',
        layer,
        '10',
        formatNumber(points[0].x),
        '20',
        formatNumber(points[0].y),
        '11',
        formatNumber(points[1].x),
        '21',
        formatNumber(points[1].y),
      );
      return;
    }
    const vertices = path.meta.closed ? points : points;
    lines.push(
      '0',
      'LWPOLYLINE',
      '8',
      layer,
      '90',
      String(vertices.length),
      '70',
      path.meta.closed ? '1' : '0',
    );
    vertices.forEach((point) => {
      lines.push('10', formatNumber(point.x), '20', formatNumber(point.y));
    });
  });

  lines.push('0', 'ENDSEC', '0', 'EOF');
  return lines.join('\n');
};

export type { ParsedDXFShape };
