import { resolve } from "node:path";
import { JsonFileChallengeRepository } from "../repositories/jsonFileChallengeRepository.js";
import { JsonInviteStore } from "./inviteStore.js";
import { createMobileApi, parseApiUsers } from "./mobileApi.js";

const dataFile = resolve(process.env.MOMENTUM_API_DATA_FILE ?? ".tmp/momentum-mobile-api.json");
const proofDirectory = resolve(process.env.MOMENTUM_API_PROOF_DIR ?? ".tmp/momentum-mobile-proofs");
const inviteFile = resolve(process.env.MOMENTUM_API_INVITE_FILE ?? ".tmp/momentum-mobile-invites.json");
const host = process.env.MOMENTUM_API_HOST ?? "127.0.0.1";
const port = Number(process.env.MOMENTUM_API_PORT ?? "8787");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("MOMENTUM_API_PORT must be a valid TCP port.");
const users = parseApiUsers(process.env.MOMENTUM_API_USERS);
const repository = new JsonFileChallengeRepository(dataFile);
await repository.init();
const inviteStore = new JsonInviteStore(inviteFile);
await inviteStore.init();
const server = createMobileApi({ repository, inviteStore, proofDirectory, users });
server.listen(port, host, () => process.stdout.write(`Momentum mobile API listening on http://${host}:${port}\n`));
