// tv-focus.js: 自動讓 onclick 的元素可被 focus
document.addEventListener("DOMContentLoaded", () => {
  const clickable = document.querySelectorAll("div[onclick], span[onclick]");
  clickable.forEach(el => {
    el.setAttribute("tabindex", "0");
  });
});
