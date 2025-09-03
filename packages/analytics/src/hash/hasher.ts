import { salted } from "../hash";
import type { PrivacyMode } from "../types";

export class Hasher {
  constructor(private salt: string, private privacy: PrivacyMode) {}

  projectId(remoteUrl?: string) {
    return salted(remoteUrl || "unknown", this.salt);
  }

  fileHash(absPath?: string) {
    if (!absPath) return "unknown";
    return salted(absPath, this.salt);
  }

  privacyMode() { return this.privacy; }
}
