import type { Pack } from "./store";
import type { CalibrationResult } from "./calibrate";
import type { InstallPlan, InstallResult } from "./install";

export type { Pack, CalibrationResult, InstallPlan, InstallResult };

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
  hasMetaTemplate: boolean;
  platform: string;
}
