import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import * as Layer from "effect/Layer";

export const layer = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, NetService.layer);
