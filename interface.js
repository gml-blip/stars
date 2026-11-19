'use strict';

const stage = document.querySelector('#stage');
const welcome = document.querySelector('#welcome');
const start = document.querySelector('#start');
const help = document.querySelector('#show-help');
const message = document.querySelector('#load-message');
const canvas = stage.querySelector('canvas');
let started = false;

welcome.showModal();
stage.setAttribute('aria-hidden', 'true');

if (canvas) {
  start.disabled = false;
  message.hidden = true;
  start.focus();
} else {
  message.textContent = '未能启动 3D 场景。请使用支持 WebGL 的浏览器并重新加载。';
}

function enterGame() {
  if (start.disabled) return;

  started = true;
  welcome.close();
  stage.removeAttribute('aria-hidden');
  help.hidden = false;
  start.textContent = '继续航行';
  stage.focus();
}

start.addEventListener('click', enterGame);
help.addEventListener('click', () => {
  welcome.showModal();
  start.focus();
});
welcome.addEventListener('cancel', event => {
  event.preventDefault();
  if (started) enterGame();
});
