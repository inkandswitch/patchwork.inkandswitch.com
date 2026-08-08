const off = name => { throw new Error(`@keyhive/keyhive noop: ${name} used but keyhive is disabled`) }

export class Access { constructor() { off("Access") } free() {} }
export class Agent { constructor() { off("Agent") } free() {} }
export class AllAgentEvents { constructor() { off("AllAgentEvents") } free() {} }
export class Archive { constructor() { off("Archive") } free() {} }
export class CannotParseEd25519SigningKey { constructor() { off("CannotParseEd25519SigningKey") } free() {} }
export class CannotParseIdentifier { constructor() { off("CannotParseIdentifier") } free() {} }
export class Capability { constructor() { off("Capability") } free() {} }
export class CgkaOperation { constructor() { off("CgkaOperation") } free() {} }
export class ChangeId { constructor() { off("ChangeId") } free() {} }
export class CiphertextStore { constructor() { off("CiphertextStore") } free() {} }
export class ContactCard { constructor() { off("ContactCard") } free() {} }
export class DecryptedKeyed { constructor() { off("DecryptedKeyed") } free() {} }
export class Delegation { constructor() { off("Delegation") } free() {} }
export class DocContentRefs { constructor() { off("DocContentRefs") } free() {} }
export class Document { constructor() { off("Document") } free() {} }
export class DocumentId { constructor() { off("DocumentId") } free() {} }
export class Encrypted { constructor() { off("Encrypted") } free() {} }
export class EncryptedContentWithUpdate { constructor() { off("EncryptedContentWithUpdate") } free() {} }
export class EncryptedKeyed { constructor() { off("EncryptedKeyed") } free() {} }
export class Event { constructor() { off("Event") } free() {} }
export class GenerateWebCryptoError { constructor() { off("GenerateWebCryptoError") } free() {} }
export class Group { constructor() { off("Group") } free() {} }
export class GroupId { constructor() { off("GroupId") } free() {} }
export class History { constructor() { off("History") } free() {} }
export class Identifier { constructor() { off("Identifier") } free() {} }
export class Individual { constructor() { off("Individual") } free() {} }
export class IndividualId { constructor() { off("IndividualId") } free() {} }
export class Invocation { constructor() { off("Invocation") } free() {} }
export class Keyhive { constructor() { off("Keyhive") } free() {} }
export class Membered { constructor() { off("Membered") } free() {} }
export class Membership { constructor() { off("Membership") } free() {} }
export class Peer { constructor() { off("Peer") } free() {} }
export class Revocation { constructor() { off("Revocation") } free() {} }
export class ShareKey { constructor() { off("ShareKey") } free() {} }
export class Signed { constructor() { off("Signed") } free() {} }
export class SignedCgkaOperation { constructor() { off("SignedCgkaOperation") } free() {} }
export class SignedDelegation { constructor() { off("SignedDelegation") } free() {} }
export class SignedInvocation { constructor() { off("SignedInvocation") } free() {} }
export class SignedRevocation { constructor() { off("SignedRevocation") } free() {} }
export class Signer { constructor() { off("Signer") } free() {} }
export class Stats { constructor() { off("Stats") } free() {} }
export class Summary { constructor() { off("Summary") } free() {} }

export function setPanicHook() { off("setPanicHook") }
export function symmetricDecrypt() { off("symmetricDecrypt") }
export function symmetricEncrypt() { off("symmetricEncrypt") }

export function initSync() {}
export default function __wbg_init() { return Promise.resolve() }
export function initFromBase64Wasm() {}
