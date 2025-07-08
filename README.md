Problem: when you have a DO with production data and you want to alter the schema, you can't just do this in the constructor as it will be ran every time.

Solution: migratable-object runs each new version just once upon construction such that your schemas can always be up-to-date.

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
