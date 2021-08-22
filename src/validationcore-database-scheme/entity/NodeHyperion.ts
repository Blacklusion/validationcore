import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from "typeorm";
import { HttpErrorType } from "../enum/HttpErrorType";
import { ValidationLevel } from "../enum/ValidationLevel";

/**
 * Store the validation results of a NodeHyperion validation
 */
@Entity()
export class NodeHyperion {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ length: 12 })
  guild: string;

  @CreateDateColumn()
  validation_date: Date;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.ERROR })
  all_checks_ok: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  location_ok: ValidationLevel;

  @Column({ nullable: false })
  endpoint_url: string;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  endpoint_url_ok: ValidationLevel;

  @Column({ default: false })
  is_ssl: boolean;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  ssl_ok: ValidationLevel;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  ssl_errortype: HttpErrorType;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_found: ValidationLevel;

  @Column({ nullable: true })
  health_ms: number;

  @Column({ nullable: true })
  health_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  health_errortype: HttpErrorType;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_version_ok: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_host_ok: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_query_time_ok: ValidationLevel;

  @Column({type: "bigint", nullable: true })
  health_query_time_ms: number;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_features_tables_proposals: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_features_tables_accounts: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_features_tables_voters: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_features_index_deltas: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_features_index_transfer_memo: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_features_index_all_deltas: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_features_deferred_trx: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_features_failed_trx: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_features_resource_limits: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_features_resource_usage: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_all_features_ok: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_nodeosrpc_ok: ValidationLevel;

  @Column({ nullable: true })
  health_nodeosrpc_message: string;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_elastic_ok: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_rabbitmq_ok: ValidationLevel;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  health_total_indexed_blocks_ok: ValidationLevel;

  @Column({ nullable: true })
  health_missing_blocks: number;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  get_transaction_ok: ValidationLevel;

  @Column({ nullable: true })
  get_transaction_ms: number;

  @Column({ nullable: true })
  get_transaction_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  get_transaction_errortype: HttpErrorType;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  get_actions_ok: ValidationLevel;

  @Column({ nullable: true })
  get_actions_ms: number;

  @Column({ nullable: true })
  get_actions_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  get_actions_errortype: HttpErrorType;

  @Column({ type: "enum", enum: ValidationLevel, default: ValidationLevel.NULL })
  get_key_accounts_ok: ValidationLevel;

  @Column({ nullable: true })
  get_key_accounts_ms: number;

  @Column({ nullable: true })
  get_key_accounts_httpcode: number;

  @Column({ type: "enum", enum: HttpErrorType, default: HttpErrorType.UNKNOWN })
  get_key_accounts_errortype: HttpErrorType;
}
