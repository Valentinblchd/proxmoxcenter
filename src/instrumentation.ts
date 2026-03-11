import { ensureBackupEngineStarted } from "@/lib/backups/engine";
import { ensureGreenItSamplerStarted } from "@/lib/greenit/sampler";

export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  ensureBackupEngineStarted();
  ensureGreenItSamplerStarted();
}
