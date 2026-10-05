import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  // One row per Clerk identity.
  users: defineTable({
    tokenIdentifier: v.string(),
    clerkId: v.optional(v.string()),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
  }).index('by_token', ['tokenIdentifier']).index('by_clerk', ['clerkId']),

  // Prevent an old session or a delayed callback from recreating a deleted account.
  deletedUsers: defineTable({
    tokenIdentifier: v.string(),
    clerkId: v.string(),
    clerkDeleted: v.boolean(),
    attempts: v.number(),
    requestedAt: v.optional(v.number()),
    lastAttemptAt: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  }).index('by_token', ['tokenIdentifier']).index('by_clerk', ['clerkId']).index('by_pending', ['clerkDeleted', 'nextAttemptAt']),

  // Reservations count against the quota before an action writes bytes to storage.
  uploads: defineTable({
    ownerId: v.id('users'),
    bytes: v.number(),
    contentType: v.string(),
    storageId: v.optional(v.id('_storage')),
    url: v.optional(v.string()),
    referenced: v.boolean(),
    digest: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  }).index('by_owner', ['ownerId']).index('by_owner_digest', ['ownerId', 'digest']).index('by_url', ['url']).index('by_storage', ['storageId']).index('by_expiry', ['expiresAt']),

  // Files from before uploads had ownership records. Reserve them while checking
  // other boxes, so a concurrent save cannot reference a file about to be removed.
  legacyMediaPurges: defineTable({
    ownerId: v.id('users'),
    storageId: v.id('_storage'),
    url: v.string(),
  }).index('by_owner', ['ownerId']).index('by_url', ['url']),

  // A box is a person's page. Tiles are kept as one ordered array so the
  // editor can save the whole layout in one go.
  boxes: defineTable({
    handle: v.string(),
    ownerId: v.optional(v.id('users')),
    demo: v.optional(v.boolean()),
    name: v.string(),
    bio: v.string(),
    avatar: v.optional(v.union(v.string(), v.null())),
    // A looping clip that plays over `avatar`, which then serves as its poster.
    avatarVideo: v.optional(v.union(v.string(), v.null())),
    avatarPos: v.optional(v.string()),
    avatarShape: v.optional(v.string()),
    footer: v.optional(v.string()),
    onboarding: v.optional(v.boolean()),
    shared: v.optional(v.boolean()),
    // Existing boxes stay discoverable unless their owner opts out.
    showInExplore: v.optional(v.boolean()),
    suggestions: v.optional(v.array(v.any())),
    tiles: v.array(v.any()),
    // Tile ids in phone order, once the phone layout has been arranged on its own.
    mobile: v.optional(v.array(v.string())),
    updatedAt: v.number(),
    revision: v.optional(v.number()),
    lastSaveId: v.optional(v.string()),
    // Last time a visit looked for stale GitHub graphs to refresh.
    ghCheckedAt: v.optional(v.number()),
    // Fetched previews live apart from editor content and do not advance its revision.
    linkPreviews: v.optional(v.array(v.any())),
    // false once the owner turns off showing their box to the boxes they visit.
    shareVisits: v.optional(v.boolean()),
    // false once the owner turns off the email about each new subscriber.
    notifySubscribers: v.optional(v.boolean()),
  })
    .index('by_handle', ['handle'])
    .index('by_owner', ['ownerId'])
    .index('by_updated', ['updatedAt']),

  // Current expiry for removed tiles. Old jobs must respect a later removal's grace.
  tilePurges: defineTable({
    boxId: v.id('boxes'),
    tileId: v.string(),
    expiresAt: v.number(),
  }).index('by_box_tile', ['boxId', 'tileId']),

  // Visitor activity lives outside the box so the owner's saves never clobber it.
  counters: defineTable({
    boxId: v.id('boxes'),
    tileId: v.string(),
    count: v.number(),
  }).index('by_box_tile', ['boxId', 'tileId']),

  purrs: defineTable({
    boxId: v.id('boxes'),
    tileId: v.string(),
    visitorKey: v.string(),
  }).index('by_box_visitor', ['boxId', 'visitorKey', 'tileId'])
    .index('by_box_tile', ['boxId', 'tileId']),

  scribbles: defineTable({
    boxId: v.id('boxes'),
    tileId: v.string(),
    d: v.string(),
    name: v.string(),
    visitorKey: v.optional(v.string()),
  }).index('by_box_tile', ['boxId', 'tileId']),

  subscribers: defineTable({
    boxId: v.id('boxes'),
    tileId: v.string(),
    email: v.string(),
    visitorKey: v.string(),
  })
    .index('by_box_tile_email', ['boxId', 'tileId', 'email'])
    .index('by_box_visitor', ['boxId', 'visitorKey']),

  // Visits by signed-in people with a box, so owners can see who came by. Rows from
  // the earlier opt-in system carry a visitorKey instead and expire like the rest.
  visits: defineTable({
    boxId: v.id('boxes'),
    visitorKey: v.optional(v.string()),
    viewerBoxId: v.optional(v.id('boxes')),
    at: v.number(),
  })
    .index('by_box_at', ['boxId', 'at'])
    .index('by_box_visitor', ['boxId', 'visitorKey', 'at'])
    .index('by_at', ['at'])
    .index('by_visitor', ['visitorKey'])
    .index('by_viewer', ['viewerBoxId'])
    .index('by_box_viewer', ['boxId', 'viewerBoxId', 'at']),

  // Withdrawal also blocks late requests from other tabs using the old key.
  revokedVisitKeys: defineTable({
    visitorKey: v.string(),
    expiresAt: v.number(),
  }).index('by_key', ['visitorKey']).index('by_expiry', ['expiresAt']),

  // Anonymous page views per box and hour, for the owner's "when they come by" chart.
  // Only counts, never who; kept for 30 days.
  viewHours: defineTable({
    boxId: v.id('boxes'),
    hour: v.number(),
    count: v.number(),
  })
    .index('by_box_hour', ['boxId', 'hour'])
    .index('by_hour', ['hour']),

  // Running visit total per box, kept apart from `visits` so explore can rank by it.
  views: defineTable({
    boxId: v.id('boxes'),
    count: v.number(),
  })
    .index('by_box', ['boxId'])
    .index('by_count', ['count']),

  // Fixed-window counters that keep public buttons from being hammered.
  limits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index('by_key', ['key']).index('by_window', ['windowStart']),

  // Shared images the app ships with: demo cats, playlist covers and so on.
  assets: defineTable({
    key: v.string(),
    storageId: v.id('_storage'),
    url: v.string(),
  }).index('by_key', ['key']).index('by_storage', ['storageId']),
});
