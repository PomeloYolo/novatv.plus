// tv.js: 電視遙控器方向鍵操作
document.addEventListener("DOMContentLoaded", () => {
  let focusable = [];
  let currentIndex = 0;

  const updateFocusable = () => {
    focusable = Array.from(document.querySelectorAll(
      "button, a, input, [tabindex='0']"
    ));
  };

  updateFocusable();

  // 初始 focus
  if (focusable.length > 0) {
    focusable[0].focus();
  }

  document.addEventListener("keydown", (e) => {
    if (!focusable.length) return;

    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        currentIndex = (currentIndex + 1) % focusable.length;
        break;

      case "ArrowLeft":
      case "ArrowUp":
        currentIndex = (currentIndex - 1 + focusable.length) % focusable.length;
        break;

      case "Enter":
        focusable[currentIndex].click();
        break;
    }

    focusable[currentIndex].focus();
  });
});
