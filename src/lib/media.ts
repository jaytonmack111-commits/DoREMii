export function fileUrl(path: string) {
  return `doremi-media://audio/?path=${encodeURIComponent(path)}`
}
