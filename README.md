Adds function `migrate` to your DO that runs migrations that didn't run yet.

```
npm i migratable-object
```

```ts
import { Migratable } from "migratable-object";

@Migratable({
  migrations: {
    "1": ["CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)"],
    "2": ["ALTER TABLE users ADD COLUMN email TEXT"],
  },
})
class MyMigratableObject extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    // Your regular request can assume the migrations were ran.
    return new Response("Hello World!");
  }
}
```
