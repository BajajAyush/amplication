import normalize from "normalize-path";
import winston from "winston";
import { createDTOs } from "./server/resource/create-dtos";
import {
  Entity,
  EntityField,
  Module,
  EnumDataType,
  LookupResolvedProperties,
  types,
  serverDirectories,
  clientDirectories,
  DSGResourceData,
  Plugin,
} from "@amplication/code-gen-types";
import { createUserEntityIfNotExist } from "./server/user-entity";
import { createAdminModules } from "./admin/create-admin";
import { createServerModules } from "./server/create-server";
import DsgContext from "./dsg-context";
import pluralize from "pluralize";
import { camelCase } from "camel-case";
import registerPlugins from "./register-plugin";
import { get } from "lodash";
import { SERVER_BASE_DIRECTORY } from "./server/constants";
import { CLIENT_BASE_DIRECTORY } from "./admin/constants";

export async function createDataServiceImpl(
  dSGResourceData: DSGResourceData,
  logger: winston.Logger
): Promise<Module[]> {
  logger.info("Creating application...");
  const {
    plugins: resourcePlugins,
    entities,
    roles,
    resourceInfo: appInfo,
  } = dSGResourceData;
  const timer = logger.startTimer();
  if (!entities || !roles || !appInfo) {
    throw new Error("Missing required data");
  }
  // make sure that the user table is existed if not it will crate one
  const [entitiesWithUserEntity, userEntity] = createUserEntityIfNotExist(
    entities
  );

  const entitiesWithPluralName = prepareEntityPluralName(
    entitiesWithUserEntity
  );

  const normalizedEntities = resolveLookupFields(
    entitiesWithPluralName,
    resourcePlugins
  );

  const context = DsgContext.getInstance;
  context.appInfo = appInfo;
  context.roles = roles;
  context.entities = normalizedEntities;
  const plugins = await registerPlugins(resourcePlugins);
  context.serverDirectories = dynamicServerPathCreator(
    get(appInfo, "settings.serverSettings.serverPath", "")
  );
  context.clientDirectories = dynamicClientPathCreator(
    get(appInfo, "settings.adminUISettings.adminUIPath", "")
  );

  context.plugins = plugins;

  logger.info("Creating DTOs...");
  const dtos = await createDTOs(normalizedEntities);
  context.DTOs = dtos;

  logger.info("Copying static modules...");

  const modules = (
    await Promise.all([
      createServerModules(
        normalizedEntities,
        roles,
        appInfo,
        dtos,
        userEntity,
        logger
      ),
      (appInfo.settings.adminUISettings.generateAdminUI &&
        createAdminModules()) ||
        [],
    ])
  ).flat();

  timer.done({ message: "Application creation time" });

  /** @todo make module paths to always use Unix path separator */
  return modules.map((module) => ({
    ...module,
    path: normalize(module.path),
  }));
}
function validatePath(path: string): string | null {
  return path.trim() || null;
}

function dynamicServerPathCreator(serverPath: string): serverDirectories {
  const baseDirectory = validatePath(serverPath) || SERVER_BASE_DIRECTORY;
  const srcDirectory = `${baseDirectory}/src`;
  return {
    baseDirectory: baseDirectory,
    srcDirectory: srcDirectory,
    scriptsDirectory: `${baseDirectory}/scripts`,
    authDirectory: `${baseDirectory}/auth`,
  };
}

function dynamicClientPathCreator(clientPath: string): clientDirectories {
  const baseDirectory = validatePath(clientPath) || CLIENT_BASE_DIRECTORY;
  const srcDirectory = `${baseDirectory}/src`;
  return {
    baseDirectory: baseDirectory,
    srcDirectory: srcDirectory,
    publicDirectory: `${baseDirectory}/public`,
    apiDirectory: `${srcDirectory}/api`,
    authDirectory: `${srcDirectory}/auth-provider`,
  };
}

function prepareEntityPluralName(entities: Entity[]): Entity[] {
  const currentEntities = entities.map((entity) => {
    entity.pluralName = pluralize(camelCase(entity.name));
    return entity;
  });
  return currentEntities;
}

function resolveLookupFields(
  entities: Entity[],
  installedPlugins: Plugin[]
): Entity[] {
  const isMySQLPluginInstalled = installedPlugins.find(
    (plugin) => plugin.npm === "@amplication/plugin-db-mysql"
  );
  const entityIdToEntity: Record<string, Entity> = {};
  const fieldIdToField: Record<string, EntityField> = {};
  for (const entity of entities) {
    entityIdToEntity[entity.id] = entity;
    for (const field of entity.fields) {
      fieldIdToField[field.permanentId] = field;
    }
  }
  return entities.map((entity) => {
    return {
      ...entity,
      fields: entity.fields.map((field) => {
        if (
          isMySQLPluginInstalled &&
          field.dataType === EnumDataType.MultiSelectOptionSet
        ) {
          throw new Error(
            `Multi Select Option Set is not supported by MySQL prisma provider. You can select another data type or change your DB to PostgreSQL`
          );
        }
        if (field.dataType === EnumDataType.Lookup) {
          const fieldProperties = field.properties as types.Lookup;

          const { relatedEntityId, relatedFieldId } = fieldProperties;
          if (!relatedEntityId) {
            throw new Error(
              `Lookup entity field ${field.name} must have a relatedEntityId property with a valid entity ID`
            );
          }
          if (!relatedFieldId) {
            throw new Error(
              `Lookup entity field ${field.name} must have a relatedFieldId property with a valid entity ID`
            );
          }
          const relatedEntity = entityIdToEntity[relatedEntityId];
          const relatedField = fieldIdToField[relatedFieldId];
          if (!relatedEntity) {
            throw new Error(
              `Could not find entity with the ID ${relatedEntityId} referenced in entity field ${field.name}`
            );
          }
          if (!relatedField) {
            throw new Error(
              `Could not find entity field with the ID ${relatedFieldId} referenced in entity field ${field.name}`
            );
          }

          const relatedFieldProperties = relatedField.properties as types.Lookup;

          const isOneToOne =
            !fieldProperties.allowMultipleSelection &&
            !relatedFieldProperties.allowMultipleSelection;

          //**@todo: in one-to-one relation, only one side should have a foreign key.
          //We currently decide randomly based on sorting the permanent ID
          //instead we should let the user decide which side holds the foreign key  */
          const isOneToOneWithoutForeignKey =
            isOneToOne && field.permanentId > relatedField.permanentId;

          const properties: LookupResolvedProperties = {
            ...field.properties,
            relatedEntity,
            relatedField,
            isOneToOneWithoutForeignKey,
          };
          return {
            ...field,
            properties,
          };
        }
        return field;
      }),
    };
  });
}
