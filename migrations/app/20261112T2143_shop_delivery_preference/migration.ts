#!/usr/bin/env -S bun
import type { Contract as Start } from '../../snapshots/6494104d31de4a658f13826be519eda3454ed97c77eafba80c116a9cd8b89c5f/contract';
import startContract from '../../snapshots/6494104d31de4a658f13826be519eda3454ed97c77eafba80c116a9cd8b89c5f/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/fa9fc1c4181ecdd802e78c10ec1874287aee3d57a6b7eeac7c1a9211e1ff8d19/contract';
import endContract from '../../snapshots/fa9fc1c4181ecdd802e78c10ec1874287aee3d57a6b7eeac7c1a9211e1ff8d19/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'ShopDeliveryPreference',
        members: ['SHIP', 'GRANT_CARD'],
      }),
      this.addColumn({
        schema: 'public',
        table: 'shop_order',
        column: col('deliveryPreference', '"ShopDeliveryPreference"', {
          codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'ShopDeliveryPreference' } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
