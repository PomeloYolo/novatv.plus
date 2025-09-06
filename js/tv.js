// tv.js: 電視遙控器支援

function enableTvMode() {
  // 對搜尋結果與熱門推薦區域加上 tabindex
  const results = document.querySelectorAll("#results .card, #douban-results .card");
  results.forEach(card => {
    card.setAttribute("tabindex", "0");
  });
}

// 偵測 DOM 更新 (因為卡片是動態生成的)
const observer = new MutationObserver(() => {
  enableTvMode();
});
observer.observe(document.body, { childList: true, subtree: true });

// 遙控器方向鍵支援
document.addEventListener("keydown", (e) => {
  const focusable = Array.from(document.querySelectorAll("[tabindex='0']"));
  const index = focusable.indexOf(document.activeElement);

  if (index === -1) return;

  const cols = 4; // 假設一列 4 個 (可以依實際 grid 修改)

  switch (e.key) {
    case "ArrowRight":
      if (focusable[index + 1]) focusable[index + 1].focus();
      break;
    case "ArrowLeft":
      if (focusable[index - 1]) focusable[index - 1].focus();
      break;
    case "ArrowDown":
      if (focusable[index + cols]) focusable[index + cols].focus();
      break;
    case "ArrowUp":
      if (focusable[index - cols]) focusable[index - cols].focus();
      break;
    case "Enter":
      document.activeElement.click();
      break;
  }
});
