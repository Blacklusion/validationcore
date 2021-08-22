import { Entity, Column, PrimaryColumn } from "typeorm";

/**
 * Stores information about a telegram user (username, chatId etc.) and their preferences (e.g. if notifications for Apis are muted or not etc.)
 */
@Entity()
export class TelegramUser {
  @PrimaryColumn({ unique: true })
  chatId: number;

  @Column()
  username: string;

  @Column()
  guild: string;

  @Column({ default: true })
  mainnet_subscribe: boolean;

  @Column("timestamp", { nullable: true })
  mainnet_mute: Date;

  @Column({ default: true })
  mainnet_producer: boolean;

  @Column({ default: true })
  mainnet_organization: boolean;

  @Column({ default: true })
  mainnet_seed: boolean;

  @Column({ default: true })
  mainnet_api: boolean;

  @Column({ default: true })
  mainnet_history: boolean;

  @Column({ default: true })
  testnet_subscribe: boolean;

  @Column("timestamp", { nullable: true })
  testnet_mute: Date;

  @Column({ default: true })
  testnet_producer: boolean;

  @Column({ default: true })
  testnet_organization: boolean;

  @Column({ default: true })
  testnet_seed: boolean;

  @Column({ default: true })
  testnet_api: boolean;

  @Column({ default: true })
  testnet_history: boolean;
}
