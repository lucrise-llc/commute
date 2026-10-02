import m0000 from './20261001234039_init/migration.sql';
import m0001 from './20261002005546_checks/migration.sql';
import m0002 from './20261002014817_resolver/migration.sql';
import m0003 from './20261002021846_overlap/migration.sql';

  export default {
    migrations: {
      "20261001234039_init": m0000,
"20261002005546_checks": m0001,
"20261002014817_resolver": m0002,
"20261002021846_overlap": m0003
}
  }
  