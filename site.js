// This site's own furniture: the top bar, its menu, the link to the source. None of it is Atlas's,
// so none of it is in app.js. With index.html and page.css this file is "the site": one more
// consumer of mount(). The version on this file's address is handed on to app.js.
const version = new URL(import.meta.url).search;
const { mount } = await import(`./app.js${version}`);

// On GitHub Pages the source lives at github.com/<owner>/<repo>; derive it so forks link to themselves.
const gh = document.querySelector(".gh-link");
const pagesHost = /^([^.]+)\.github\.io$/.exec(location.hostname);
if (gh && pagesHost) gh.href = `https://github.com/${pagesHost[1]}/${location.pathname.split("/").filter(Boolean)[0] || ""}`;

const atlas = mount(document.querySelector("#main"), { syncUrl: true, setTitle: true, sourceUrl: gh ? gh.href : null });

for (const link of document.querySelectorAll(".nav a")) {
  link.toggleAttribute("aria-current", link.getAttribute("data-page") === atlas.page);
}

// Phones: the nav folds behind a menu button. Closes on a link, on Escape and on a tap outside.
const navToggle = document.querySelector(".nav-toggle");
if (navToggle) {
  const setMenu = (open) => { navToggle.setAttribute("aria-expanded", open ? "true" : "false"); document.body.classList.toggle("menu-open", open); };
  navToggle.addEventListener("click", () => setMenu(navToggle.getAttribute("aria-expanded") !== "true"));
  document.addEventListener("click", (event) => { if (document.body.classList.contains("menu-open") && !event.target.closest(".topbar-left")) setMenu(false); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") setMenu(false); });
}

const topbar = document.querySelector("#topbar");
if (topbar) {
  const onScroll = () => topbar.classList.toggle("is-scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}
