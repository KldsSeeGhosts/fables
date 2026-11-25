/* oxlint-disable shadcn/no-arbitrary-values -- The thumbnail uses the Duet row's exact 220 by 132 pixel bounds and indentation. */
import { resolveMediaSource, type MediaSourceResource } from "@t3tools/client-runtime/media-source";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useState } from "react";

import { useAssetUrlState } from "../../assets/assetUrls";
import { cn } from "../../lib/utils";
import { taskPreviewImageSource } from "./captainTaskPreview.logic";

export interface CaptainTaskPreviewProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly workspaceRoot?: string | null | undefined;
  readonly result: string;
}

function TaskPreviewImage({ src }: { readonly src: string }) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) return null;
  const loaded = loadedSrc === src;
  const markLoadedIfComplete = (image: HTMLImageElement | null) => {
    if (!image) return;
    // Cached images are complete before `onLoad` can fire.
    if (image.complete && image.naturalWidth > 0) setLoadedSrc(src);
  };
  return (
    <span className={cn("relative block pl-5.5 duet:pl-[26px]", loaded && "mt-2")}>
      <img
        ref={markLoadedIfComplete}
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        className={cn(
          "h-[132px] w-full max-w-[220px] rounded-md border border-(--duet-hairline) object-cover object-top",
          loaded ? "block" : "invisible absolute",
        )}
        onLoad={() => {
          setLoadedSrc(src);
          setFailedSrc(null);
        }}
        onError={() => {
          setFailedSrc(src);
          setLoadedSrc(null);
        }}
      />
    </span>
  );
}

function EnvironmentTaskPreviewImage({
  environmentId,
  resource,
  srcFragment,
}: {
  readonly environmentId: EnvironmentId;
  readonly resource: MediaSourceResource;
  readonly srcFragment: string;
}) {
  const assetUrl = useAssetUrlState(environmentId, resource);
  if (assetUrl._tag !== "Success") return null;
  return <TaskPreviewImage src={assetUrl.url + srcFragment} />;
}

/** A finished local task's decorative result thumbnail, when its final reply embedded an image. */
export function CaptainTaskPreview({
  environmentId,
  threadId,
  workspaceRoot,
  result,
}: CaptainTaskPreviewProps) {
  const source = taskPreviewImageSource(result, workspaceRoot);
  if (source === null) return null;
  const media = resolveMediaSource(source, { threadId, workspaceRoot, imageEmbed: true });
  if (media === null || media.kind !== "image") return null;
  if (media.access === "direct") return <TaskPreviewImage src={media.uri} />;
  if (media.access !== "environment") return null;
  return (
    <EnvironmentTaskPreviewImage
      environmentId={environmentId}
      resource={media.resource}
      srcFragment={media.srcFragment}
    />
  );
}
