// Worker-produced media is written under <mediaDir>/<projectId>/... and served
// by the api at GET /media/<projectId>/... (docker-compose shares the volume).
// Event paths are absolute container paths (/app/media/...) or the default
// relative "media/..."; both contain the "/<projectId>/" segment, which is the
// stable anchor for building the browser URL.
export function mediaUrl(projectId: string, absPath: string | undefined): string | undefined {
  if (!absPath) return undefined
  const marker = `/${projectId}/`
  const idx = absPath.indexOf(marker)
  if (idx === -1) return undefined
  const rest = absPath.slice(idx + marker.length)
  return `/media/${projectId}/${rest}`
}
