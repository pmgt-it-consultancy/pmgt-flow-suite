import { Model } from "@nozbe/watermelondb";
import { field, text } from "@nozbe/watermelondb/decorators";

export class SpikeProduct extends Model {
  static table = "spike_products";

  @text("name") name!: string;
  @field("price") price!: number;
}
