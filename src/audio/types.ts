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
  lowFreqWeight?: number;
  highFreqWeight?: number;
  stability?: number;
  spectralCentroid?: number;
  spectralFlux?: number;
  beatDensity?: number;
  intensity?: number;
}

export type MusicStyle = 'rock' | 'electronic' | 'hiphop' | 'ambient' | 'pop' | 'orchestral' | 'unknown';
export type SegmentIntensityRole = 'setup' | 'groove' | 'peak' | 'climax' | 'release';
export type SegmentAttackHint = 'none' | 'sparse-ring' | 'aimed-burst' | 'screen-ring' | 'lane-burst';

export interface TrackStyleProfile {
  primaryStyle: MusicStyle;
  confidence: number;
  energyMean: number;
  lowFreqWeight: number;
  highFreqWeight: number;
  dynamicRange: number;
  beatDensity: number;
  segmentContrast: number;
  descriptors: string[];
}

export interface SegmentFeature extends MusicSegment {
  beatDensity: number;
  lowFreqWeight: number;
  highFreqWeight: number;
  stability: number;
  intensityRole: SegmentIntensityRole;
  recommendedAttack: SegmentAttackHint;
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
  styleProfile?: TrackStyleProfile;
  segmentFeatures?: SegmentFeature[];
  tempoCandidates: TempoCandidate[];
  warmupWindow: WarmupWindow;
  calibration: CalibrationResult | null;
}
