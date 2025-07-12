Problem: when you have a DO with production data and you want to alter the schema, you can't just do this in the constructor as it will be ran every time.

Solution: migratable-object runs each new version just once upon construction such that your schemas can always be up-to-date.

```
npm i migratable-object
```

```ts
import { Migratable, MigratableObject } from "migratable-object";

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

Or this is the other way to use it without the decorator:

```ts
import { MigratableObject } from "migratable-object";

export class ItemsStore extends MigratableObject {
  constructor(state, env) {
    super(state, env, {
      migrations: {
        "1": ["CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)"],
        "2": ["ALTER TABLE users ADD COLUMN email TEXT"],
      },
    });
  }
}
```

# Changelog

- 2025-07-08 - initial version (https://x.com/janwilmake/status/1942514837332058225)
- 2025-07-12 - When the migration failed and contains an error we should show this and throw entire DO; When migration succeeds and contained an error before, error should be removed (https://x.com/janwilmake/status/1944000217746993484)
