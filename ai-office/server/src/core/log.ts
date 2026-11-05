import { logs, type LogRow } from '../db/index.js';
import { bus } from './bus.js';

export function writeLog(entry: Omit<LogRow, 'id' | 'createdAt'>) {
  const row = logs.add(entry);
  bus.publish({ type: 'log', log: row });
  return row;
}
