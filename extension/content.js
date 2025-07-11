
let emoteMapping = {};

chrome.storage.local.get(['emoteMapping'], (result) => {
  if (result.emoteMapping) {
    emoteMapping = result.emoteMapping;
  }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (changes.emoteMapping) {
    emoteMapping = changes.emoteMapping.newValue;
  }
});

let typedText = '';
const MAX_BUFFER = 30;

document.addEventListener('input', (event) => {
  const { target } = event;
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
    if (event.data) {
      typedText += event.data;
    } else if (event.inputType === 'deleteContentBackward') {
      typedText = typedText.slice(0, -1);
    }
    if (typedText.length > MAX_BUFFER) {
      typedText = typedText.slice(-MAX_BUFFER);
    }

    const words = typedText.split(/\s+/);
    const lastWord = words[words.length - 1];

    if (emoteMapping[lastWord]) {
      const emoteUrl = emoteMapping[lastWord];
      const emoteImg = `<img src="${emoteUrl}" alt="${lastWord}" style="height: 1.5em; vertical-align: middle;" />`;

      if (target.isContentEditable) {
        const range = window.getSelection().getRangeAt(0);
        range.setStart(range.startContainer, range.startOffset - lastWord.length);
        range.deleteContents();
        range.insertNode(range.createContextualFragment(emoteImg));
        range.collapse(false);
      } else {
        const value = target.value;
        const selectionStart = target.selectionStart;
        const newValue = value.slice(0, selectionStart - lastWord.length) + emoteImg + value.slice(selectionStart);
        target.value = newValue;
      }
      typedText = '';
    }
  }
}); 