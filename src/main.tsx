import { render } from 'preact';
import './styles.css';
import { App } from './app';
import { getLocale } from './i18n';

document.documentElement.lang = getLocale();

const root = document.getElementById('app');

if (root) {
  render(<App />, root);
}
