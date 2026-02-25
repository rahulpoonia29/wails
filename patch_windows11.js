const fs = require('fs');

let file = fs.readFileSync('v3/pkg/application/webview_window_windows.go', 'utf8');

file = file.replace(`import (
	"errors"
	"fmt"
	"net/url"`, `import (
	"errors"
	"fmt"
	"net/http"
	"net/url"`);

// Let's use standard w32 window post message or whatever is used to run on main thread
// InvokeSync and dispatchOnMainThread use globalApplication.mainWindow, but THIS webview has ITS OWN window!
// w.hwnd is the window handle for THIS webview.
// If we execute it directly via a message to w.hwnd, it will execute on the exact thread that created the webview window!

file = file.replace(/func \(w \*windowsWebviewWindow\) getCookies[\s\S]*?func \(w \*windowsWebviewWindow\) execJS\(js string\) {/m, `func (w *windowsWebviewWindow) getCookies(url string) []*http.Cookie {
	if w.chromium == nil {
		return nil
	}

	resultChan := make(chan []*http.Cookie, 1)

	// Since we need to run on the EXACT thread that created this specific webview window,
	// and globalApplication.dispatchOnMainThread might be tied to the application's main thread (not necessarily this window's thread),
	// let's use the Wails InvokeSync which usually is safe, but wait, it failed!
	// Oh wait, my JS script in patch_windows10 had a syntax error so it never applied, and the exe running was STILL the old one!
	
	globalApplication.dispatchOnMainThread(func() {
		var err error
		var cm *edge.ICoreWebView2CookieManager
		
		cm, err = w.chromium.GetCookieManager()
		if err != nil {
			fmt.Println("Error getting cookie manager:", err)
			resultChan <- nil
			return
		}
		defer cm.Release()

		list, err := cm.GetCookies(url)
		if err != nil {
			fmt.Println("Error getting cookies list:", err)
			resultChan <- nil
			return
		}
		defer list.Release()

		count, err := list.GetCount()
		if err != nil {
			fmt.Println("Error getting count:", err)
			resultChan <- nil
			return
		}

		var found []*http.Cookie
		for i := uint32(0); i < count; i++ {
			cookie, err := list.GetItem(i)
			if err != nil {
				continue
			}

			name, _ := cookie.GetName()
			value, _ := cookie.GetValue()
			domain, _ := cookie.GetDomain()
			path, _ := cookie.GetPath()
			expires, _ := cookie.GetExpires()
			isHttpOnly, _ := cookie.GetIsHttpOnly()
			isSecure, _ := cookie.GetIsSecure()

			found = append(found, &http.Cookie{
				Name:     name,
				Value:    value,
				Domain:   domain,
				Path:     path,
				Expires:  time.Unix(int64(expires), 0),
				HttpOnly: isHttpOnly,
				Secure:   isSecure,
			})
			cookie.Release()
		}
		
		resultChan <- found
	})

	return <-resultChan
}

func (w *windowsWebviewWindow) execJS(js string) {`);

fs.writeFileSync('v3/pkg/application/webview_window_windows.go', file);
