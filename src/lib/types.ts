import type { Pack } from "./store";
import type { CalibrationResult } from "./calibrate";
import type { InstallPlan, InstallResult } from "./install";
import type { Vocabulary } from "./vocab";

export type { Pack, CalibrationResult, InstallPlan, InstallResult, Vocabulary };

export interface PreviewFile {
  file: string;
  width: number;
  height: number;
  bytes: number;
  description: string;
  unverified: boolean;
  dataUrl: string;
}

export interface AppStatus {
  niImageDir: string;
  rootExists: boolean;
  rootWritable: boolean;
  home: string;
  hasOpenAiKey: boolean;
  hasSerpKey: boolean;
  distDbDir: string;
  distDbExists: boolean;
  platform: string;
}
