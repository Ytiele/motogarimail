export const THEME_KEY = "motogari-theme";
/** Desktop sidebar state ("open" | "collapsed"), read on the server so the layout renders at the right width. */
export const SIDEBAR_COOKIE = "motogari-sidebar";

// Inlined in <head> so the correct theme is set before first paint (no flash of the wrong theme).
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem('${THEME_KEY}')||'system';var d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){}})();`;
