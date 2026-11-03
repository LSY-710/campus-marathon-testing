import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import automator from "miniprogram-automator";

const root = fileURLToPath(new URL("../", import.meta.url));
const projectPath = join(root, "apps", "miniapp");
const cliPath =
  process.env.WECHAT_CLI ??
  "D:\\HBuilderx\\微信web开发者工具\\cli.bat";
const screenshotDir = join(root, "test-results", "miniapp");
mkdirSync(screenshotDir, { recursive: true });

async function guarded(label, action, timeoutMs = 15_000) {
  let timer;
  try {
    return await Promise.race([
      action,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Mini program step timed out: ${label}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const miniProgram = await guarded(
  "connect",
  process.env.WECHAT_WS
    ? automator.connect({ wsEndpoint: process.env.WECHAT_WS })
    : automator.launch({
        cliPath,
        projectPath,
        port: Number(process.env.WECHAT_AUTO_PORT ?? 9422),
        trustProject: true,
        timeout: 60_000,
      }),
  25_000,
);

const runtimeErrors = [];
miniProgram.on("exception", (error) => runtimeErrors.push(error));
miniProgram.on("console", (entry) => {
  if (entry.type === "error") runtimeErrors.push(entry);
});

try {
  const home = await guarded(
    "open home",
    miniProgram.reLaunch("/pages/home/home"),
  );
  await guarded("wait home", home.waitFor(2_000), 5_000);
  const homeData = await guarded("read home data", home.data());
  assert.ok(homeData.events.length > 0, "home page should load events");
  assert.ok(
    (await guarded("find home cards", home.$$(".race-card"))).length > 0,
    "home page should render race cards",
  );
  await guarded(
    "capture home",
    miniProgram.screenshot({
      path: join(screenshotDir, "home-v2.png"),
    }),
  );

  const firstEvent = homeData.events[0];
  const detail = await guarded(
    "open detail",
    miniProgram.navigateTo(`/pages/detail/detail?id=${firstEvent.id}`),
  );
  await guarded("wait detail", detail.waitFor(1_500), 5_000);
  assert.ok(
    await guarded("find detail hero", detail.$(".detail-hero")),
    "detail hero should render",
  );
  assert.ok(
    await guarded("find detail sheet", detail.$(".detail-sheet")),
    "detail content should render",
  );
  await guarded(
    "capture detail",
    miniProgram.screenshot({
      path: join(screenshotDir, "detail-v2.png"),
    }),
  );

  const events = await guarded(
    "open events",
    miniProgram.switchTab("/pages/events/events"),
  );
  await guarded("wait events", events.waitFor(1_500), 5_000);
  assert.ok(
    await guarded("find event grid", events.$(".race-grid")),
    "event grid should render",
  );
  await guarded(
    "capture events",
    miniProgram.screenshot({
      path: join(screenshotDir, "events-v2.png"),
    }),
  );

  const login = await guarded(
    "open login",
    miniProgram.navigateTo("/pages/login/login"),
  );
  await guarded("wait login", login.waitFor(800), 5_000);
  assert.ok(
    await guarded("find login form", login.$(".login-form")),
    "login form should render",
  );
  await guarded(
    "capture login",
    miniProgram.screenshot({
      path: join(screenshotDir, "login-v2.png"),
    }),
  );
  await guarded(
    "submit login",
    (await guarded("find login button", login.$(".login-button"))).tap(),
  );
  await new Promise((resolve) => setTimeout(resolve, 1_800));

  const profile = await guarded(
    "open profile",
    miniProgram.switchTab("/pages/profile/profile"),
  );
  await guarded("wait profile", profile.waitFor(1_200), 5_000);
  assert.ok(
    await guarded("find profile", profile.$(".runner-poster")),
    "logged-in profile should render",
  );
  await guarded(
    "capture profile",
    miniProgram.screenshot({
      path: join(screenshotDir, "profile-v2.png"),
    }),
  );

  const reviews = await guarded(
    "open reviews",
    miniProgram.navigateTo(
      `/pages/reviews/reviews?eventId=${firstEvent.id}`,
    ),
  );
  await guarded("wait reviews", reviews.waitFor(1_200), 5_000);
  assert.ok(
    await guarded("find review form", reviews.$(".review-panel")),
    "review form should render",
  );
  await guarded(
    "capture reviews",
    miniProgram.screenshot({
      path: join(screenshotDir, "reviews-v2.png"),
    }),
  );

  const certificates = await guarded(
    "open certificates",
    miniProgram.navigateTo("/pages/certificates/certificates"),
  );
  await guarded("wait certificates", certificates.waitFor(1_000), 5_000);
  assert.ok(
    await guarded(
      "find certificates",
      certificates.$(".certificates-page"),
    ),
    "certificate archive should render",
  );
  await guarded(
    "capture certificates",
    miniProgram.screenshot({
      path: join(screenshotDir, "certificates-v2.png"),
    }),
  );

  assert.deepEqual(runtimeErrors, [], "mini program emitted runtime errors");
  console.log("Mini program smoke test passed");
  console.log(`Screenshots: ${screenshotDir}`);
} finally {
  await guarded("disconnect", miniProgram.disconnect(), 5_000).catch(
    () => undefined,
  );
}
