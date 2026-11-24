import { expectTypeOf, test } from "vitest";

import type {
  PublishPorts,
  PublishPortsEntityType,
  PublishPortsSlice,
} from "../contracts/site/publish-ports.js";

/**
 * @file Pins the keyed-bag contract a publish engine is generic over (`PublishPorts`). The bag is a
 * pure mapped type, so the contract is its compile-time behaviour: one required key per `entityType`,
 * each carrying exactly that type's slice. Every assertion below is a type assertion — a drift fails
 * `tsc`/vitest typecheck, not a runtime branch.
 */
type PostSlice = { readonly repo: { readonly find: () => string }; readonly remove?: () => void };
type MediaSlice = { readonly blobStore: { readonly put: () => void } };
type Bag = PublishPorts<{ post: PostSlice; media: MediaSlice; "content-type": { readonly key: string } }>;

test("the bag has one key per entityType, each carrying exactly that type's slice", () => {
  expectTypeOf<Bag["post"]>().toEqualTypeOf<PostSlice>();
  expectTypeOf<Bag["media"]>().toEqualTypeOf<MediaSlice>();
  expectTypeOf<keyof Bag>().toEqualTypeOf<"post" | "media" | "content-type">();
});

test("a forgotten entityType is a type error, not a silently-absent port", () => {
  // @ts-expect-error `media` is a required key of the bag: a root that omits it must not compile.
  const missing: Bag = { post: { repo: { find: () => "x" } }, "content-type": { key: "k" } };
  void missing;
  const complete: Bag = { post: { repo: { find: () => "x" } }, media: { blobStore: { put: () => {} } }, "content-type": { key: "k" } };
  expectTypeOf(complete).toEqualTypeOf<Bag>();
});

test("a half-supplied slice is a type error", () => {
  // @ts-expect-error `post.repo` is required inside the slice.
  const halfSlice: Bag = { post: {}, media: { blobStore: { put: () => {} } }, "content-type": { key: "k" } };
  void halfSlice;
});

test("the bag is readonly: a root cannot swap a type's ports after composition", () => {
  const bag = {} as Bag;
  // @ts-expect-error entityType keys are readonly.
  bag.post = { repo: { find: () => "x" } };
  expectTypeOf<Readonly<Bag>>().toEqualTypeOf<Bag>();
});

test("a host composes its own slices onto a capability bag by intersection", () => {
  type HostBag = Bag & PublishPorts<{ "theme-files": { readonly themesDir: string } }>;
  expectTypeOf<HostBag["theme-files"]>().toEqualTypeOf<{ readonly themesDir: string }>();
  expectTypeOf<HostBag["post"]>().toEqualTypeOf<PostSlice>();
});

test("the key and slice helpers read a bag back", () => {
  expectTypeOf<PublishPortsEntityType<Bag>>().toEqualTypeOf<"post" | "media" | "content-type">();
  expectTypeOf<PublishPortsSlice<Bag, "media">>().toEqualTypeOf<MediaSlice>();
});
