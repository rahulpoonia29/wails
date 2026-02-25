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

file = file.replace(/func \(w \*windowsWebviewWindow\) execJS\(js string\) {/m, `func (w *windowsWebviewWindow) getCookies(url string) []*http.Cookie {
	if w.chromium == nil {
		return nil
	}

	var cookies []*http.Cookie
	var wg sync.WaitGroup
	wg.Add(1)

	// Windows COM requires everything on the same thread.
	// Instead of InvokeSync which posts a message, let's use globalApplication.dispatchOnMainThread directly.
	// Wait, earlier globalApplication.dispatchOnMainThread failed with the SAME thread error.
	// Let's check how execJS does it: it uses globalApplication.dispatchOnMainThread
	
	InvokeSync(func() {
		defer wg.Done()
		
		cm, err := w.chromium.GetCookieManager()
		if err != nil {
			fmt.Println("Error getting cookie manager:", err)
			return
		}
		defer cm.Release()

		list, err := cm.GetCookies(url)
		if err != nil {
			fmt.Println("Error getting cookies list:", err)
			return
		}
		defer list.Release()

		count, err := list.GetCount()
		if err != nil {
			fmt.Println("Error getting count:", err)
			return
		}

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

			cookies = append(cookies, &http.Cookie{
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
	})

	wg.Wait()
	return cookies
}

func (w *windowsWebviewWindow) execJS(js string) {`);

fs.writeFileSync('v3/pkg/application/webview_window_windows.go', file);
