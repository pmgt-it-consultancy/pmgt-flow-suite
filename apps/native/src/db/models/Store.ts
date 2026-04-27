import { Model } from "@nozbe/watermelondb";
import { field, text } from "@nozbe/watermelondb/decorators";

export class Store extends Model {
  static table = "stores";

  @text("server_id") serverId?: string;
  @text("name") name!: string;
  @field("parent_id") parentId?: string;
  @text("logo") logo?: string;
  @text("address1") address1!: string;
  @text("address2") address2?: string;
  @text("tin") tin!: string;
  @text("min") min!: string;
  @field("vat_rate") vatRate!: number;
  @text("printer_mac") printerMac?: string;
  @text("kitchen_printer_mac") kitchenPrinterMac?: string;
  @text("contact_number") contactNumber?: string;
  @text("telephone") telephone?: string;
  @text("email") email?: string;
  @text("website") website?: string;
  @text("footer") footer?: string;
  @text("schedule_json") scheduleJson?: string;
  @field("is_active") isActive!: boolean;
  @field("created_at") createdAt!: number;
  @field("device_code_counter") deviceCodeCounter?: number;
  @field("updated_at") updatedAt!: number;
}
