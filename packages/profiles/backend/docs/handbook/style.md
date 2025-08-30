# Style Handbook (Backend, C#)

- No TODO comments — link an issue instead.
- Avoid `Console.WriteLine` / `Debug.WriteLine` in production code.
- Prefer `IHttpClientFactory` over `new HttpClient()`.
- Avoid string-concatenated SQL; use parameters/ORM.
