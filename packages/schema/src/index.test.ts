import { describe, expect, it } from 'vitest';
import sample from '../fixtures/v1-sample.json';
import { CURRENT_VERSION, loadProject } from './index';

const clone = (): Record<string, any> => structuredClone(sample);
const errorsOf = (input: unknown) => {
  const r = loadProject(input);
  if (r.ok) throw new Error('expected the project to be rejected');
  return r.errors.join('\n');
};

describe('loadProject', () => {
  it('accepts the v1 sample project', () => {
    const r = loadProject(sample);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.project.name).toBe(sample.name);
  });

  it('does not modify its input', () => {
    const input = clone();
    loadProject(input);
    expect(input).toEqual(sample);
  });

  it.each([
    [
      'fractional time',
      (p: any) => {
        p.sequences[0].tracks[0].clips[0].startUs = 1.5;
      },
      '/startUs',
    ],
    [
      'image with a duration',
      (p: any) => {
        p.assets.ast_logo0001.durationUs = 5;
      },
      '/assets/ast_logo0001',
    ],
    [
      'mime type not from the allowed list',
      (p: any) => {
        p.assets.ast_talk0001.mime = 'video/avi';
      },
      '/mime',
    ],
    [
      'unknown caption language',
      (p: any) => {
        p.captionTracks[0].lang = 'ta';
      },
      '/lang',
    ],
    [
      'unknown cut status',
      (p: any) => {
        p.cutSets[0].regions[0].status = 'maybe';
      },
      '/status',
    ],
    [
      'unknown top-level field',
      (p: any) => {
        p.foo = 1;
      },
      'additional properties',
    ],
    [
      'video without duration',
      (p: any) => {
        delete p.assets.ast_talk0001.durationUs;
      },
      'durationUs',
    ],
  ])('rejects %s', (_label, mutate, expected) => {
    const p = clone();
    mutate(p);
    expect(errorsOf(p)).toContain(expected);
  });

  it.each([
    [
      'a clip pointing at a missing asset',
      (p: any) => {
        p.sequences[0].tracks[0].clips[0].assetId = 'ast_missing01';
      },
      'asset "ast_missing01" doesn\'t exist',
    ],
    [
      'an out point before the in point',
      (p: any) => {
        p.sequences[0].tracks[0].clips[0].outUs = 1000;
      },
      'out point must be after in point',
    ],
    [
      'a cut set for a missing clip',
      (p: any) => {
        p.cutSets[0].clipId = 'clp_missing01';
      },
      'clip "clp_missing01" doesn\'t exist',
    ],
    [
      'a caption anchored to a missing clip',
      (p: any) => {
        p.captionTracks[0].segments[0].anchor.clipId = 'clp_missing01';
      },
      'clip "clp_missing01" doesn\'t exist',
    ],
    [
      'duplicate ids',
      (p: any) => {
        p.sequences[0].tracks[1].clips[0].id = 'clp_talk0001';
      },
      'used more than once',
    ],
    [
      'an asset whose id differs from its key',
      (p: any) => {
        p.assets.ast_logo0001.id = 'ast_other001';
      },
      "doesn't match its key",
    ],
    [
      'a caption ending before it starts',
      (p: any) => {
        p.captionTracks[0].segments[0].endUs = 0;
      },
      'end must be after start',
    ],
  ])('rejects %s', (_label, mutate, expected) => {
    const p = clone();
    mutate(p);
    expect(errorsOf(p)).toContain(expected);
  });

  it('refuses projects from a newer app version with a clear message', () => {
    expect(errorsOf({ ...clone(), schemaVersion: CURRENT_VERSION + 1 })).toContain('newer Klipzo');
  });

  it.each([null, [], 'project', 42, {}, { schemaVersion: '1' }, { schemaVersion: 0 }])('rejects non-project input %j', (input) => {
    expect(errorsOf(input)).toContain('Not a Klipzo project');
  });
});
