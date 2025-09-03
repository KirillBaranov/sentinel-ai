import { pathToFileURL } from 'node:url'

export const linkifyFile = (absPath: string) => pathToFileURL(absPath).href
