Adds function `migrate` to your DO that runs migrations that didn't run yet.

```
npm i migratable-object
```

```ts
import { Migratable, MigrateFn } from "migratable-object";

@Migratable({
  migrations: {
    "1": ["CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)"],
    "2": ["ALTER TABLE users ADD COLUMN email TEXT"],
  },
})
class MyMigratableObject extends DurableObject {
  migrate: MigrateFn;

  async fetch(request: Request): Promise<Response> {
    // Run migrations before handling requests
    const migrationResults: MigrationResult[] = await this.migrate();

    if (migrationResults.length > 0) {
      console.log("Applied migrations:", migrationResults);
    }

    // Your regular request handling logic here
    return new Response("Hello World!");
  }
}
```
