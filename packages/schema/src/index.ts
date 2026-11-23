import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import schema from '../project.schema.json';
import type { KlipzoProjectV1 } from './types';

export type Project = KlipzoProjectV1;
export type LoadResult = { ok: true; project: Project; migratedFrom?: number } | { ok: false; errors: string[] };

export const CURRENT_VERSION = 1;

type Json = Record<string, unknown>;
// MIGRATIONS[n] turns a version-n project into version n+1. Add one per schema change, with a fixture test.
export const MIGRATIONS: Record<number, (project: Json) => Json> = {};

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile<Project>(schema);

/** Parse-time entry point for every project file: upgrade old versions, validate shape, then check references. */
export function loadProject(input: unknown): LoadResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return fail('Not a Klipzo project file.');
  const from = (input as Json).schemaVersion;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) return fail('Not a Klipzo project file (no schema version).');
  if (from > CURRENT_VERSION) {
    return fail(
      `This project was saved by a newer Klipzo (format v${from}; this app reads up to v${CURRENT_VERSION}). Please update the app.`,
    );
  }

  let project = structuredClone(input) as Json;
  for (let v = from; v < CURRENT_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return fail(`Can't upgrade project format v${v}.`);
    project = { ...step(project), schemaVersion: v + 1 };
  }

  if (!validate(project)) {
    return { ok: false, errors: (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`) };
  }
  const errors = checkReferences(project);
  if (errors.length) return { ok: false, errors };
  return from < CURRENT_VERSION ? { ok: true, project, migratedFrom: from } : { ok: true, project };
}

/** Rules JSON Schema can't express: ids unique, references point at things that exist, ranges not inverted. */
export function checkReferences(p: Project): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const unique = (id: string, where: string) => {
    if (seen.has(id)) errors.push(`${where}: id "${id}" is used more than once`);
    seen.add(id);
  };
  const sequenceIds = new Set(p.sequences.map((s) => s.id));
  const clipIds = new Set<string>();

  for (const [key, asset] of Object.entries(p.assets)) {
    if (asset.id !== key) errors.push(`/assets/${key}: id "${asset.id}" doesn't match its key`);
    unique(asset.id, `/assets/${key}`);
  }
  p.sequences.forEach((seq, si) => {
    unique(seq.id, `/sequences/${si}`);
    seq.tracks.forEach((track, ti) => {
      unique(track.id, `/sequences/${si}/tracks/${ti}`);
      track.clips.forEach((clip, ci) => {
        const at = `/sequences/${si}/tracks/${ti}/clips/${ci}`;
        unique(clip.id, at);
        clipIds.add(clip.id);
        if (clip.type === 'media') {
          if (!p.assets[clip.assetId]) errors.push(`${at}: asset "${clip.assetId}" doesn't exist`);
          if (clip.outUs <= clip.inUs) errors.push(`${at}: out point must be after in point`);
        } else if (clip.durationUs <= 0) errors.push(`${at}: duration must be positive`);
      });
    });
  });
  p.cutSets.forEach((cut, i) => {
    unique(cut.id, `/cutSets/${i}`);
    if (!clipIds.has(cut.clipId)) errors.push(`/cutSets/${i}: clip "${cut.clipId}" doesn't exist`);
    cut.regions.forEach((r, ri) => {
      if (r.endUs <= r.startUs) errors.push(`/cutSets/${i}/regions/${ri}: end must be after start`);
    });
  });
  p.captionTracks.forEach((track, i) => {
    unique(track.id, `/captionTracks/${i}`);
    if (!sequenceIds.has(track.sequenceId)) errors.push(`/captionTracks/${i}: sequence "${track.sequenceId}" doesn't exist`);
    track.segments.forEach((s, si) => {
      const at = `/captionTracks/${i}/segments/${si}`;
      if (s.endUs <= s.startUs) errors.push(`${at}: end must be after start`);
      if (s.anchor.type === 'clip' && !clipIds.has(s.anchor.clipId)) errors.push(`${at}: clip "${s.anchor.clipId}" doesn't exist`);
    });
  });
  p.markers.forEach((m, i) => {
    if (!sequenceIds.has(m.sequenceId)) errors.push(`/markers/${i}: sequence "${m.sequenceId}" doesn't exist`);
  });
  p.library.forEach((item, i) => {
    if (!p.assets[item.assetId]) errors.push(`/library/${i}: asset "${item.assetId}" doesn't exist`);
  });
  return errors;
}

function fail(message: string): LoadResult {
  return { ok: false, errors: [message] };
}
