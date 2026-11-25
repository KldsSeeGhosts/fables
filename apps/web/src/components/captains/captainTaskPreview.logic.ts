import { classifyMarkdownImageSource } from "@t3tools/shared/markdownLinks";
import { chatMarkdownImageSources } from "@t3tools/shared/markdownPipeline";

export const TASK_PREVIEW_DATA_URL_MAX_CHARS = 64_000;

const DATA_IMAGE_URL_PATTERN = /^data:image\/[\w.+-]+[;,]/i;
const HTTP_IMAGE_URL_PATTERN = /^https?:\/\//i;

function usableTaskPreviewImageSource(source: string, workspaceRoot: string | null | undefined) {
  if (/^data:/i.test(source)) {
    return DATA_IMAGE_URL_PATTERN.test(source) && source.length <= TASK_PREVIEW_DATA_URL_MAX_CHARS;
  }
  if (HTTP_IMAGE_URL_PATTERN.test(source)) return true;
  return classifyMarkdownImageSource(source, workspaceRoot)._tag === "WorkspaceFile";
}

/** The last image in a finished task result that is cheap and safe enough for a row thumbnail. */
export function taskPreviewImageSource(
  markdown: string,
  workspaceRoot?: string | null | undefined,
): string | null {
  if (!markdown.includes("![") && !/<img/i.test(markdown)) return null;
  const sources = chatMarkdownImageSources(markdown);
  for (let index = sources.length - 1; index >= 0; index -= 1) {
    const source = sources[index];
    if (source !== undefined && usableTaskPreviewImageSource(source, workspaceRoot)) return source;
  }
  return null;
}
