/* Generated from project.schema.json by json-schema-to-typescript. Do not edit; run pnpm schema:types. */

export type Id = string;
export type Fit = 'fit' | 'fill' | 'blur';
export type Color = string;
export type Asset = {
  id: Id;
  kind: 'video' | 'audio' | 'image';
  name: string;
  /**
   * SHA-256 of size + first 1 MB + last 1 MB
   */
  contentHash: string;
  size: number;
  /**
   * Sniffed from magic bytes, never from the extension
   */
  mime: 'video/mp4' | 'video/quicktime' | 'video/x-matroska' | 'video/webm' | 'audio/mpeg' | 'audio/wav' | 'image/png' | 'image/jpeg';
  /**
   * Absent for images
   */
  durationUs?: number;
  video?: {
    width: number;
    height: number;
    fps: Rational;
    rotation: 0 | 90 | 180 | 270;
    codec: string;
    transfer?: 'sdr' | 'hlg' | 'pq' | 'apple-log' | 'slog3' | 'dlog-m' | 'unknown';
  };
  audio?: {
    channels: number;
    sampleRate: number;
  };
  source: {
    type: 'path' | 'handle' | 'opfs' | 'url';
    ref: string;
  };
  proxy: {
    status: 'none' | 'pending' | 'ready' | 'failed';
    ref?: string;
  };
};
/**
 * Time in microseconds
 */
export type Us = number;
/**
 * A constant value or keyframes in clip-relative time
 */
export type Keyframed =
  | number
  | [
      {
        tUs: Us;
        v: number;
        ease?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';
      },
      ...{
        tUs: Us;
        v: number;
        ease?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';
      }[],
    ];

/**
 * Non-destructive edit decision list. Source media is never modified; all times are integer microseconds.
 */
export interface KlipzoProjectV1 {
  schemaVersion: 1;
  id: Id;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: Settings;
  assets: {
    [k: string]: Asset;
  };
  /**
   * @minItems 1
   */
  sequences: [Sequence, ...Sequence[]];
  cutSets: CutSet[];
  captionTracks: CaptionTrack[];
  library: LibraryItem[];
  markers: Marker[];
  luts: {
    [k: string]: Lut;
  };
  dictionary: DictEntry[];
}
export interface Settings {
  /**
   * 16:9, 9:16, 1:1, 4:5, 21:9 or custom
   */
  ratio: {
    w: number;
    h: number;
  };
  outputHeight: number;
  fps: Rational;
  sampleRate: 44100 | 48000;
  defaultFit: Fit;
  background: Color;
}
export interface Rational {
  num: number;
  den: number;
}
export interface Sequence {
  id: Id;
  name: string;
  ratio?: Ratio;
  /**
   * Bottom to top
   */
  tracks: Track[];
}
/**
 * Overrides project ratio (e.g. a 9:16 reel inside a 16:9 project)
 */
export interface Ratio {
  w: number;
  h: number;
}
export interface Track {
  id: Id;
  kind: 'video' | 'audio' | 'text' | 'overlay';
  name: string;
  muted: boolean;
  locked: boolean;
  hidden: boolean;
  clips: (MediaClip | TextClip)[];
}
export interface MediaClip {
  type: 'media';
  id: Id;
  assetId: Id;
  /**
   * Position on the sequence
   */
  startUs: number;
  /**
   * Source in-point (for images: 0)
   */
  inUs: number;
  /**
   * Source out-point (for images: display length)
   */
  outUs: number;
  speed: number;
  reverse: boolean;
  volume: number;
  /**
   * Absent = project default
   */
  fit?: 'fit' | 'fill' | 'blur';
  transform: Transform;
  opacity: Keyframed;
  transitionIn?: Transition;
  grade: Grade;
  reframe?: {
    mode: 'off' | 'auto' | 'manual';
    keyframes: {
      tUs: Us;
      cx: number;
      cy: number;
    }[];
  };
  effects?: {
    type: string;
    params: {
      [k: string]: number | string | boolean;
    };
  }[];
}
export interface Transform {
  /**
   * Centre offset, fraction of frame width
   */
  x:
    | number
    | [
        {
          tUs: Us;
          v: number;
          ease?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';
        },
        ...{
          tUs: Us;
          v: number;
          ease?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';
        }[],
      ];
  /**
   * Centre offset, fraction of frame height
   */
  y:
    | number
    | [
        {
          tUs: Us;
          v: number;
          ease?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';
        },
        ...{
          tUs: Us;
          v: number;
          ease?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';
        }[],
      ];
  scale: Keyframed;
  /**
   * A constant value or keyframes in clip-relative time
   */
  rotation:
    | number
    | [
        {
          tUs: Us;
          v: number;
          ease?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';
        },
        ...{
          tUs: Us;
          v: number;
          ease?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';
        }[],
      ];
}
export interface Transition {
  type: 'cut' | 'fade' | 'dip' | 'slide' | 'zoom' | 'wipe';
  durationUs: Us;
}
export interface Grade {
  enabled: boolean;
  /**
   * true while values are untouched Auto Grade output
   */
  auto: boolean;
  /**
   * EV
   */
  exposure: number;
  temperature: number;
  tint: number;
  contrast: number;
  saturation: number;
  vibrance: number;
  skinProtect: number;
  inputTransform: 'none' | 'hlg' | 'pq' | 'apple-log' | 'slog3' | 'dlog-m';
  look: {
    lutId?: Id;
    mood?: 'warm' | 'teal-orange' | 'moody' | 'bright' | 'bw';
    intensity: number;
  };
  match: null | {
    refClipId: Id;
    /**
     * @minItems 3
     * @maxItems 3
     */
    scale: [number, number, number];
    /**
     * @minItems 3
     * @maxItems 3
     */
    offset: [number, number, number];
  };
}
export interface TextClip {
  type: 'text';
  id: Id;
  startUs: Us;
  durationUs: Us;
  text: string;
  style: TextStyle;
  transform?: Transform;
}
export interface TextStyle {
  font: 'Noto Sans Devanagari' | 'Mukta' | 'Poppins';
  /**
   * Percent of min(frame width, height)
   */
  sizePct: number;
  weight?: 400 | 500 | 600 | 700 | 800;
  color: Color;
  highlightColor?: Color;
  outline?: {
    color: Color;
    widthPct: number;
  };
  shadow?: {
    color: Color;
    blurPct: number;
    dxPct: number;
    dyPct: number;
  };
  box?: {
    color: Color;
    paddingPct: number;
    radiusPct: number;
  };
  /**
   * Vertical centre; clamped to the ratio's safe area at render time
   */
  yPct?: number;
  animation?: 'none' | 'pop' | 'karaoke';
}
export interface CutSet {
  id: Id;
  clipId: Id;
  kind: 'silence' | 'filler';
  mode: 'remove' | 'shorten' | 'mark';
  params: {
    thresholdDb: number;
    minSilenceUs: number;
    padBeforeUs: number;
    padAfterUs: number;
    keepPausesUnderUs: number;
    shortenToUs?: number;
    punchIn?: number;
    fillers?: string[];
  };
  /**
   * Items: Source time of the clip's asset
   */
  regions: {
    id: Id;
    startUs: Us;
    endUs: Us;
    status: 'proposed' | 'accepted' | 'rejected';
    reason?: string;
  }[];
}
export interface CaptionTrack {
  id: Id;
  sequenceId: Id;
  /**
   * hi-Latn = Hinglish (Roman Hindi)
   */
  lang: 'hi' | 'en' | 'hi-Latn';
  label?: string;
  style: TextStyle;
  visible: boolean;
  segments: Segment[];
}
export interface Segment {
  id: Id;
  /**
   * clip: times are the clip asset's source time and follow trims/cuts; timeline: times are sequence time
   */
  anchor:
    | {
        type: 'clip';
        clipId: Id;
      }
    | {
        type: 'timeline';
      };
  startUs: Us;
  endUs: Us;
  text: string;
  /**
   * Roman (Hinglish) form for the Devanagari/Roman toggle
   */
  roman?: string;
  words?: {
    text: string;
    startUs: Us;
    endUs: Us;
    conf?: number;
  }[];
  speaker?: string;
  /**
   * true once a person changed it; re-transcription never overwrites edited segments
   */
  edited: boolean;
}
export interface LibraryItem {
  id: Id;
  assetId: Id;
  inUs: Us;
  outUs: Us;
  tags: string[];
  note?: string;
  score?: number;
  reason?: string;
}
export interface Marker {
  id: Id;
  sequenceId: Id;
  timeUs: Us;
  label: string;
  color?: Color;
}
export interface Lut {
  name: string;
  size: number;
  /**
   * OPFS / app-data location of the parsed LUT
   */
  ref: string;
}
export interface DictEntry {
  from: string;
  to: string;
  lang?: 'hi' | 'en' | 'hi-Latn';
}
