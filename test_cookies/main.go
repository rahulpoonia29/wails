package main

import (
	"fmt"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

func main() {
	app := application.New(application.Options{
		Name:        "myapp",
		Description: "A demo of using raw HTML & CSS",
	})

	webview := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "Cookie Test",
		Width:  900,
		Height: 700,
		Hidden: false,
		URL:    "https://google.com",
	})

	webview.Show()
	webview.Focus()

	webview.OnWindowEvent(events.Windows.WebViewNavigationCompleted, func(e *application.WindowEvent) {
		fmt.Println("Navigation completed, attempting to extract cookies...")

		// Extract all cookies from the webview for the domain
		cookies := webview.GetCookies("https://google.com")

		if cookies == nil {
			fmt.Println("Cookies returned nil! This indicates an error in GetCookies.")
		} else if len(cookies) == 0 {
			fmt.Println("Cookies array is empty, but not nil.")
		} else {
			fmt.Printf("✓ Extracted %d cookies from Google\n", len(cookies))

			// Log the cookie names for debugging
			for _, c := range cookies {
				fmt.Printf("  - %s (HttpOnly: %v, Secure: %v)\n", c.Name, c.HttpOnly, c.Secure)
			}
		}
	})

	err := app.Run()

	if err != nil {
		log.Fatal(err)
	}
}
