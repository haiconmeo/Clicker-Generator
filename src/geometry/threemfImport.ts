// Parse a bundled .3mf asset into raw indexed mesh arrays, normalized to mm.
// Works in a worker (no DOM): fflate unzip + regex over the model XML.
import { unzipSync, strFromU8 } from 'fflate';

export interface RawMesh {
  vertProperties: Float32Array; // xyz interleaved (numProp = 3)
  triVerts: Uint32Array;
  numProp: 3;
}

const UNIT_TO_MM: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

function attr(tag: string, name: string): string | null {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] ?? null;
}

function parseModelXml(xml: string): RawMesh | null {
  const unit = (xml.match(/<[^>]*\bmodel\b[^>]*\bunit\s*=\s*["']([^"']+)["']/i)?.[1] ?? 'millimeter').toLowerCase();
  const s = UNIT_TO_MM[unit] ?? 1;
  const verts: number[] = [];
  const tris: number[] = [];

  const objectRe = /<(?:\w+:)?object\b[^>]*>[\s\S]*?<\/(?:\w+:)?object>/gi;
  const objects = [...xml.matchAll(objectRe)].map((m) => m[0]);
  const blocks = objects.length ? objects : [xml];

  for (const block of blocks) {
    if (!/<(?:\w+:)?mesh\b/i.test(block)) continue;
    const offset = verts.length / 3;
    let localCount = 0;
    const vre = /<(?:\w+:)?vertex\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = vre.exec(block))) {
      const x = attr(m[0], 'x');
      const y = attr(m[0], 'y');
      const z = attr(m[0], 'z');
      if (x == null || y == null || z == null) continue;
      verts.push(parseFloat(x) * s, parseFloat(y) * s, parseFloat(z) * s);
      localCount++;
    }

    const tre = /<(?:\w+:)?triangle\b[^>]*>/gi;
    while ((m = tre.exec(block))) {
      const v1 = attr(m[0], 'v1');
      const v2 = attr(m[0], 'v2');
      const v3 = attr(m[0], 'v3');
      if (v1 == null || v2 == null || v3 == null) continue;
      const a = +v1;
      const b = +v2;
      const c = +v3;
      if (a >= localCount || b >= localCount || c >= localCount) continue;
      tris.push(offset + a, offset + b, offset + c);
    }
  }

  if (verts.length < 9 || tris.length < 3) return null;
  return {
    vertProperties: new Float32Array(verts),
    triVerts: new Uint32Array(tris),
    numProp: 3,
  };
}

export function parse3MF(buf: ArrayBuffer): RawMesh {
  const files = unzipSync(new Uint8Array(buf));
  const modelKeys = Object.keys(files)
    .filter((k) => k.toLowerCase().endsWith('.model'))
    .sort((a, b) => Number(b.toLowerCase().endsWith('3dmodel.model')) - Number(a.toLowerCase().endsWith('3dmodel.model')));
  if (!modelKeys.length) throw new Error('3MF: missing model file');

  for (const key of modelKeys) {
    const parsed = parseModelXml(strFromU8(files[key]));
    if (parsed) return parsed;
  }
  throw new Error('3MF: empty or unparseable mesh');
}
