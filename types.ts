
export interface ProcessedSlice {
  id: string;
  originalSlice: string; // base64
  enhancedSlice: string | null; // base64
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
}

export interface GridJob {
  id: string;
  fileName: string;
  originalImage: string; // base64
  rows: number;
  cols: number;
  slices: ProcessedSlice[];
}

export interface AppSettings {
  rows: number;
  cols: number;
  enhanceQuality: boolean;
  removeText: boolean;
}
