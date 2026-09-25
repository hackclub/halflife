import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../src/app/generated/prisma/client"
import { PostKind, PostStatus, Theme } from "../src/app/generated/prisma/enums"

/**
 * End-to-end check of the Doomscroller.
 *
 * The properties worth asserting:
 *
 * 1. Counts cannot be inflated. The program pays prizes on virality, so a view
 *    or like count anyone can move by refreshing is a number that decides who
 *    gets a drawing tablet.
 * 2. A reel cannot point at someone else's upload, or at a key outside the
 *    posts folder. The object key travels through the browser between the
 *    upload and the post, so the server cannot trust it.
 * 3. Denormalised counts agree with the rows they summarise, including after a
 *    moderator hides something.
 *
 * Run with `pnpm verify:feed` against a scratch database.
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
})

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  if (!pass) failures++
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
  )
}

async function refused(label: string, fn: () => Promise<unknown>): Promise<void> {
  let threw = false
  try {
    await fn()
  } catch {
    threw = true
  }
  check(label, threw, true)
}

async function main() {
  const feed = await import("../src/lib/feed")
  const { createPost, getFeed, recordView, setLike, addComment, getComments } = feed
  const { deleteOwnComment, hidePost, restorePost, hideComment, deleteOwnPost } = feed

  const stamp = Date.now()
  const author = await prisma.user.create({
    data: { email: `reel-author-${stamp}@example.test`, name: "Author" },
  })
  const viewer = await prisma.user.create({
    data: { email: `reel-viewer-${stamp}@example.test`, name: "Viewer" },
  })
  const project = await prisma.themeProject.create({
    data: { userId: author.id, theme: Theme.PCB, title: "Reel project" },
  })
  const otherProject = await prisma.themeProject.create({
    data: { userId: viewer.id, theme: Theme.PCB, title: "Not yours" },
  })

  const key = (userId: string) => `posts/${userId}/${crypto.randomUUID()}.mp4`

  // ── Object key ownership ───────────────────────────────────────────────────
  await refused("cannot post someone else's upload", () =>
    createPost({
      userId: author.id,
      kind: PostKind.FREEFORM,
      caption: "stolen",
      objectKey: key(viewer.id),
      canManageFeed: false,
    }),
  )
  await refused("cannot post a key outside the posts folder", () =>
    createPost({
      userId: author.id,
      kind: PostKind.FREEFORM,
      caption: "wrong folder",
      objectKey: `sessions/${author.id}/whatever.mp4`,
      canManageFeed: false,
    }),
  )
  await refused("cannot traverse out of the prefix", () =>
    createPost({
      userId: author.id,
      kind: PostKind.FREEFORM,
      caption: "traversal",
      objectKey: `posts/${author.id}/../${viewer.id}/theirs.mp4`,
      canManageFeed: false,
    }),
  )
  await refused("cannot attach a reel to someone else's project", () =>
    createPost({
      userId: author.id,
      kind: PostKind.IDEA,
      caption: "not my project",
      objectKey: key(author.id),
      themeProjectId: otherProject.id,
      canManageFeed: false,
    }),
  )

  // ── Announcements are staff-only ───────────────────────────────────────────
  await refused("a participant cannot post an announcement", () =>
    createPost({
      userId: author.id,
      kind: PostKind.ANNOUNCEMENT,
      caption: "hi from 'HQ'",
      objectKey: key(author.id),
      canManageFeed: false,
    }),
  )

  // ── The happy path ─────────────────────────────────────────────────────────
  const post = await createPost({
    userId: author.id,
    kind: PostKind.IDEA,
    caption: "Here is what I'm making",
    objectKey: key(author.id),
    themeProjectId: project.id,
    durationSeconds: 42,
    canManageFeed: false,
  })
  check("post is published immediately", post.publishedAt !== null, true)
  check("kind recorded for the checkpoint lookup", post.kind, PostKind.IDEA)
  check("starts with no engagement", [post.viewCount, post.likeCount, post.commentCount], [0, 0, 0])

  // ── Views ──────────────────────────────────────────────────────────────────
  check("first view counts", await recordView(post.id, viewer.id), 1)
  check("the same viewer again does not", await recordView(post.id, viewer.id), 1)
  check("a third refresh still does not", await recordView(post.id, viewer.id), 1)
  check("a different viewer does", await recordView(post.id, author.id), 2)
  const viewRows = await prisma.postView.count({ where: { postId: post.id } })
  check("view rows match the count", viewRows, 2)

  // ── Likes ──────────────────────────────────────────────────────────────────
  const liked = await setLike(post.id, viewer.id, true)
  check("liking works", [liked.likeCount, liked.likedByMe], [1, true])
  const again = await setLike(post.id, viewer.id, true)
  check("liking twice is idempotent", again.likeCount, 1)
  const unliked = await setLike(post.id, viewer.id, false)
  check("unliking works", [unliked.likeCount, unliked.likedByMe], [0, false])
  const unlikedAgain = await setLike(post.id, viewer.id, false)
  check("unliking twice does not go negative", unlikedAgain.likeCount, 0)
  await setLike(post.id, viewer.id, true)
  const likeRows = await prisma.postLike.count({ where: { postId: post.id } })
  check("like rows match the count", likeRows, 1)

  // ── Comments ───────────────────────────────────────────────────────────────
  const commentA = await addComment(post.id, viewer.id, "This rules")
  const commentB = await addComment(post.id, author.id, "thanks!")
  const afterComments = await prisma.post.findUniqueOrThrow({
    where: { id: post.id },
    select: { commentCount: true },
  })
  check("comment count tracks comments", afterComments.commentCount, 2)

  const visibleComments = await getComments(post.id, viewer.id, { limit: 25 })
  check("both comments are visible", visibleComments.items.length, 2)
  check("authorship is marked for the viewer", visibleComments.items[0]?.mine, true)

  await deleteOwnComment(commentB.id, author.id)
  const afterDelete = await prisma.post.findUniqueOrThrow({
    where: { id: post.id },
    select: { commentCount: true },
  })
  check("deleting a comment decrements", afterDelete.commentCount, 1)

  await refused("cannot delete someone else's comment", () => deleteOwnComment(commentA.id, author.id))

  await hideComment(commentA.id, author.id, "off topic")
  const afterHide = await prisma.post.findUniqueOrThrow({
    where: { id: post.id },
    select: { commentCount: true },
  })
  check("hiding a comment decrements too", afterHide.commentCount, 0)
  const afterHideList = await getComments(post.id, viewer.id, { limit: 25 })
  check("a hidden comment leaves the thread", afterHideList.items.length, 0)

  // ── The feed itself ────────────────────────────────────────────────────────
  const staff = await prisma.user.create({
    data: { email: `hq-${stamp}@example.test`, name: "HQ" },
  })
  await createPost({
    userId: staff.id,
    kind: PostKind.ANNOUNCEMENT,
    caption: "Week 1 starts now",
    objectKey: key(staff.id),
    canManageFeed: true,
  })

  const page = await getFeed(viewer.id, { limit: 25 })
  check("announcements are pinned, not paged", page.pinned.length, 1)
  check("the pinned one is the announcement", page.pinned[0]?.kind, PostKind.ANNOUNCEMENT)
  check("the participant reel is in the page", page.items.length, 1)
  check("the viewer's like is reflected", page.items[0]?.likedByMe, true)
  check("the author's streak rides along", typeof page.items[0]?.author.streak, "number")

  // ── Moderation ─────────────────────────────────────────────────────────────
  await hidePost(post.id, staff.id, "not related to the program")
  const hiddenFeed = await getFeed(viewer.id, { limit: 25 })
  check("a hidden reel leaves the feed", hiddenFeed.items.length, 0)

  await restorePost(post.id)
  const restoredFeed = await getFeed(viewer.id, { limit: 25 })
  check("restoring puts it back", restoredFeed.items.length, 1)

  await deleteOwnPost(post.id, author.id)
  const deletedFeed = await getFeed(viewer.id, { limit: 25 })
  check("a deleted reel leaves the feed", deletedFeed.items.length, 0)
  const stillThere = await prisma.post.findUniqueOrThrow({
    where: { id: post.id },
    select: { status: true, deletedAt: true },
  })
  check("deletion is soft", stillThere.status, PostStatus.REMOVED)
  check("and stamped", stillThere.deletedAt !== null, true)

  await prisma.user.deleteMany({
    where: { id: { in: [author.id, viewer.id, staff.id] } },
  })

  console.log(failures === 0 ? "\nAll feed checks passed." : `\n${failures} check(s) failed.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
