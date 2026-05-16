export interface DecodedAudioBuffer {
  length: number;
  duration: number;
  sampleRate: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export interface BeatPoint {
  time: number;
  strength: number;
}

export interface MusicSegment {
  start: number;
  end: number;
  label: 'intro' | 'verse' | 'chorus' | 'bridge' | 'drop' | 'outro';
  energy: number;
}

export interface TempoCandidate {
  bpm: number;
  score: number;
  source: 'autocorrelation' | 'energy-peak' | 'spectral-flux';
}

export interface WarmupWindow {
  start: number;
  end: number;
  reason: 'high-clarity-beat' | 'high-energy-stable-section';
}

export interface CalibrationResult {
  taps: number[];
  tapDerivedBpm: number;
  selectedBpm: number;
  selectedDownbeat: number;
  halfDoubleRelation: 'none' | 'half' | 'double';
  tapStability: number;
  confirmed: boolean;
}

export interface AudioAnalysis<TBuffer extends DecodedAudioBuffer = AudioBuffer> {
  buffer: TBuffer;
  bpm: number;
  firstBeat: number;
  duration: number;
  beats: BeatPoint[];
  segments: MusicSegment[];
  tempoCandidates: TempoCandidate[];
  warmupWindow: WarmupWindow;
  calibration: CalibrationResult | null;
}
