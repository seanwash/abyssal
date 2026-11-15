import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { newLog, parseLog, type StationLog } from '../shared/station';

/**
 * Each party's station log, one JSON file per party code. On an Amp Box the files live in the
 * deployment's data directory, which survives deploys and restarts; elsewhere in ./saves, or
 * wherever ABYSSAL_SAVES points. A write goes to a temporary file that then replaces the save in
 * one rename, so a crash or a restart mid-write leaves the previous save whole.
 */
export const SAVE_DIR = process.env.ABYSSAL_SAVES
  ?? (process.env.AMP_DEPLOYMENT_DATA_DIRECTORY ? path.join(process.env.AMP_DEPLOYMENT_DATA_DIRECTORY, 'saves') : path.resolve('saves'));

const file = (party: string) => path.join(SAVE_DIR, `${party}.json`);

/** The party's log, or a new one. An unreadable file is set aside rather than overwritten. */
export function loadLog(party: string): StationLog {
  const f = file(party);
  if (!existsSync(f)) return newLog(party);
  try {
    const log = parseLog(JSON.parse(readFileSync(f, 'utf8')));
    if (log) return log;
    throw new Error('not a station log');
  } catch (err) {
    const aside = `${f}.unreadable-${Date.now()}`;
    renameSync(f, aside);
    console.error(`[save] could not read ${f} (${(err as Error).message}); moved it to ${aside} and started a new log`);
    return newLog(party);
  }
}

export function writeLog(log: StationLog) {
  mkdirSync(SAVE_DIR, { recursive: true });
  const f = file(log.party);
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(log, null, 1));
  renameSync(tmp, f);
}
