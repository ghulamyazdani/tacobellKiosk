/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk useOfferConverters wrapper (P5 port). The anys are
 * inherited; typed in the P6/P7 domain passes. Do not add NEW anys.
 */
import { useDispatch, useSelector } from "react-redux";
import {
  selectOffers,
  setFilteredOffers,
} from "@cx-sdk/ordering/state/offer.slice";

const useOfferConverters = () => {
  const dispatch = useDispatch();
  const offers = useSelector(selectOffers);

  const converOffersForGetItemByMenu = (
    entityMap: any,
    categoryMap: any,
    variantEntityMap: any,
    fetchModifierProperties: any,
    passedOffers: any,
  ) => {
    const localOffers = passedOffers ? passedOffers : offers;
    const updatedOffers = localOffers?.map((offer: any) => {
      const updatedOffer = {
        ...offer,
        applicable: {
          ...offer.applicable,
          // Verbatim fork behavior: throws if applicable.rawItems is
          // missing, preserved as-is (P6 burn-down).
          // eslint-disable-next-line no-unsafe-optional-chaining
          rawItems: [...offer?.applicable?.rawItems],
        },
        isAvailable: true,
        isBuyAndOffer: false,
        isAndOffer: true,
        getItems: { ...offer.getItems },
      };
      if (offer?.type?.name === "item" && offer.getItems) {
        const getItems = offer.getItems;
        if (getItems?.items) {
          updatedOffer.getItems.items = getItems.items.map((rawGetItem: any) => {
            // Group-wise offers carry the freebie discount in
            // buygetGroupWiseOfferValues; each getItem's own value is empty.
            // Normalise the discount once here so every downstream site (the
            // discounted_total_price math, the entity discountType/discountValue
            // stamp, the variant sub-path, the stored getItems.items entry, and
            // therefore the committed cart line + ribbon) reads the effective
            // discount with no further branching.
            const item = offer?.buygetGroupWiseOffer
              ? {
                  ...rawGetItem,
                  discountType: offer?.buygetGroupWiseOfferValues?.discountType,
                  value: Number(offer?.buygetGroupWiseOfferValues?.value),
                }
              : rawGetItem;
            const itemId = item?.baseItemId ? item?.baseItemId : item._id;
            const entity = entityMap.get(itemId);
            if (item?.relation === "or") {
              updatedOffer.isAndOffer = false;
            }
            if (
              entity &&
              !entity?.outOfStock
              // &&
              // entity?.modifiers &&
              // entity?.modifiers?.length === 0 &&
              // !entity?.hasVariant
            ) {
              let discounted_total_price = entity?.price;

              if (item?.discountType === "percent" && item?.value) {
                discounted_total_price =
                  entity?.price - (entity?.price * item?.value) / 100;
              } else if (item?.discountType === "amount" && item?.value) {
                discounted_total_price =
                  entity?.price - item?.value > 0
                    ? entity?.price - item?.value
                    : 0;
              }

              // hasVariant get-items previously returned empty entities +
              // isAvailable=false (variant freebies were disabled). We now let
              // them fall through to the entityToReturn builder below, which
              // produces a proper type:"VARIANT" entity that keeps `.variants`
              // (with their isActive flags) so the customization sheet renders
              // the variant options; the customer picks a variant like the
              // normal menu flow and the discount stamps ride on the entity.

              // if (entity?.hasVariant) {
              //   // const firstInStockAndActiveVariant = entity?.variants?.find(
              //   //   (variant: any) => !variant?.outOfStock && variant?.isActive,
              //   // );

              //   let leastValueVariant: any = {};
              //   // let leastValue = entity?.price;
              //   let leastValue = entity?.variants?.find((variantt:any)=>!variantt?.outOfStock && variantt?.isActive)?.price;

              //   entity?.variants?.forEach((variant: any) => {
              //     if (
              //       !variant?.outOfStock &&
              //       variant?.isActive &&
              //       variant?.price <= leastValue
              //     ) {
              //       leastValueVariant = variant;
              //       leastValue = variant?.price;
              //     }
              //   });

              //   if (leastValue && leastValueVariant && Object.keys(leastValueVariant).length > 0) {
              //     var modifierProperties = fetchModifierProperties(
              //       leastValueVariant?.modifiers,
              //       menuModifiers,
              //     );
              //     const returnableObject: any = {};
              //     modifierProperties?.forEach((modifier: any) => {
              //       if (modifier.isActive) {
              //         returnableObject[modifier._id] = [];
              //       }
              //     });

              //     let leastValueVariant_discounted_total_price =
              //       leastValueVariant?.price;

              //     if (item?.discountType === "percent" && item?.value) {
              //       leastValueVariant_discounted_total_price =
              //         leastValueVariant?.price -
              //         (leastValueVariant?.price * item?.value) / 100;
              //     } else if (item?.discountType === "amount" && item?.value) {
              //       leastValueVariant_discounted_total_price =
              //         leastValueVariant?.price - item?.value > 0
              //           ? leastValueVariant?.price - item?.value
              //           : 0;
              //     }

              //     console.log(
              //       "leastValueVariant",
              //       leastValueVariant,
              //       item,
              //       leastValueVariant_discounted_total_price,
              //     );
              //     return {
              //       ...item,
              //       entities: {
              //         ...entity,
              //         selectedVariant: {
              //           ...leastValueVariant,
              //           isGetItemCustomized: false,
              //           isGetItem: true,
              //           discounted_total_price:
              //             leastValueVariant_discounted_total_price,
              //         },
              //         discounted_total_price: leastValueVariant?.price,
              //         customizations: returnableObject,
              //         selectedVariantModifiers: leastValueVariant?.modifiers,
              //         baseItem: {
              //           ...entity,
              //           isGetItemCustomized: false,
              //           isGetItem: true,
              //         },
              //         baseItemPrice: entity?.price,
              //         variantPrice: leastValueVariant?.price,
              //         selectedVariantId: leastValueVariant?.id,
              //         isGetItemCustomized: false,
              //         type: "VARIANT",
              //       },
              //     };
              //   } else {
              //     return {
              //       ...item,
              //       entities: {},
              //     };
              //   }
              // }

              // console.log("firstInStockAndActiveVariantotem", item);

              const entityToReturn = {
                ...entity,
                // discounted_total_price,
                discountType: item?.discountType,
                discountValue: item?.value,
                isGetItem: true,
                // undiscounted_total_price: entity?.price,
                type: entity?.hasVariant
                  ? "VARIANT"
                  : entity?.modifiers && entity?.modifiers?.length > 0
                    ? "CUSTOMIZABLE"
                    : "ITEM",
              };

              if (
                !entity?.hasVariant &&
                entity?.modifiers &&
                entity?.modifiers?.length > 0
              ) {
                const modifierProperties = fetchModifierProperties(
                  entity?.modifiers,
                );
                const returnableObject: any = {};
                modifierProperties.forEach((modifier: any) => {
                  if (modifier?.isActive) {
                    returnableObject[modifier?._id] = [];
                  }
                });
                entityToReturn.customizations = returnableObject;
                entityToReturn.baseItem = entity;
                entityToReturn.baseItemPrice = entity?.price;
              } else {
                entityToReturn.discounted_total_price = discounted_total_price;
                entityToReturn.undiscounted_total_price = entity?.price;
              }

              return {
                ...item,
                entities: entityToReturn,
              };
            }

            if (!entity) {
              const variantEntity = variantEntityMap.get(itemId);

              // console.log("variantEntity", variantEntity);

              if (variantEntity && variantEntity?.length > 0) {
                // needed in case of variant exist in multiple base items
                // const availableBaseEntities = variantEntity?.reduce(
                //   (acc: any, variant: any) => {
                //     if (
                //       variant &&
                //       variant?.subCategoryId === item?.category?._id &&
                //       !variant?.outOfStock &&
                //       variant?.modifiers &&
                //       variant?.hasVariant
                //     ) {
                //       let discounted_total_price = variant?.price;

                //       if (item?.discountType === "percent" && item?.value) {
                //         discounted_total_price =
                //           variant?.price - (variant?.price * item?.value) / 100;
                //       } else if (
                //         item?.discountType === "amount" &&
                //         item?.value
                //       ) {
                //         discounted_total_price =
                //           variant?.price - item?.value > 0
                //             ? variant?.price - item?.value
                //             : 0;
                //       }

                //       console.log("variantvariant", variant, itemId);

                //       const selectedVariant = variant?.variants?.find(
                //         (v: any) => v.id === itemId,
                //       );

                //       var modifierProperties = fetchModifierProperties(
                //         selectedVariant?.modifiers,
                //         menuModifiers,
                //       );
                //       const returnableObject: any = {};
                //       modifierProperties.forEach((modifier: any) => {
                //         if (modifier.isActive) {
                //           returnableObject[modifier._id] = [];
                //         }
                //       });

                //       acc.push({
                //         ...variant,
                //         discounted_total_price,
                //         selectedVariant: {
                //           ...selectedVariant,
                //           isGetItemCustomized: false,
                //           isGetItem: true,
                //         },
                //         selectedVariantId: itemId,
                //         customizations: returnableObject,
                //         selectedVariantModifiers: selectedVariant?.modifiers,
                //         type: "VARIANT",
                //         baseItem: {
                //           ...variant,
                //           isGetItemCustomized: false,
                //           isGetItem: true,
                //         },
                //         baseItemPrice: variant?.price,
                //         variantPrice: selectedVariant?.price,
                //         isGetItemCustomized: false,
                //       });
                //     }
                //     return acc;
                //   },
                //   [],
                // );
                // just as same as above, only one varaint is needed from the variantEntity
                const availableBaseVaraint = variantEntity?.find(
                  (variant: any) =>
                    // variant?.subCategoryId === item?.category?._id &&
                    !variant?.outOfStock &&
                    variant?.modifiers &&
                    variant?.hasVariant,
                );

                if (availableBaseVaraint) {
                  const selectedVariant = availableBaseVaraint?.variants?.find(
                    (v: any) => {
                     return v.id === itemId && !v.outOfStock;
                    },
                  );

                  if (selectedVariant) {
                    let selectedVariant_discounted_total_price =
                      selectedVariant?.price;

                    if (item?.discountType === "percent" && item?.value) {
                      selectedVariant_discounted_total_price =
                        selectedVariant?.price -
                        (selectedVariant?.price * item?.value) / 100;
                    } else if (item?.discountType === "amount" && item?.value) {
                      selectedVariant_discounted_total_price =
                        selectedVariant?.price - item?.value > 0
                          ? selectedVariant?.price - item?.value
                          : 0;
                    }

                    const modifierProperties = fetchModifierProperties(
                      selectedVariant?.modifiers,
                    );
                    const returnableObject: any = {};
                    modifierProperties.forEach((modifier: any) => {
                      if (modifier?.isActive) {
                        returnableObject[modifier?._id] = [];
                      }
                    });

                    const availableBaseVaraintEntity = {
                      ...availableBaseVaraint,
                      discounted_total_price:
                        selectedVariant_discounted_total_price,
                      undiscounted_total_price: selectedVariant?.price,
                      isVariantSelected: true,
                      discountType: item?.discountType,
                      discountValue: item?.value,
                      selectedVariant: {
                        ...selectedVariant,
                        isGetItemCustomized: false,
                        isGetItem: true,
                        discounted_total_price:
                          selectedVariant_discounted_total_price,
                      },
                      selectedVariantId: itemId,
                      customizations: returnableObject,
                      selectedVariantModifiers: selectedVariant?.modifiers,
                      type: "VARIANT",
                      baseItem: {
                        ...availableBaseVaraint,
                        isGetItemCustomized: false,
                        isGetItem: true,
                      },
                      baseItemPrice: availableBaseVaraint?.price,
                      variantPrice: selectedVariant?.price,
                      isGetItemCustomized: false,
                      isGetItem: true,
                    };

                    return {
                      ...item,
                      entities: availableBaseVaraintEntity,
                    };
                  }
                }
              }
            }
            return {
              ...item,
              entities: {},
            };
          });
        }
        if (getItems?.categories) {
          updatedOffer.getItems.categories = getItems.categories.map(
            (category: any) => {
              const entities: any = [];

              if (categoryMap.get(category._id)) {
                const categoryMapObject = categoryMap.get(category._id);
                // create array from object values
                Object.values(categoryMapObject).forEach((value: any) => {
                  entities.push(value);
                });
              }
              if (category?.relation === "or") {
                updatedOffer.isAndOffer = false;
              }
              if (entities && entities.length > 0) {
                const availableEntities = entities.reduce(
                  (acc: any, entity: any) => {
                    // if (
                    //   entity &&
                    //   !entity.outOfStock &&
                    //   entity.modifiers &&
                    //   entity.modifiers.length === 0 &&
                    //   !entity.hasVariant
                    // ) {
                    //   let discounted_total_price = entity.price;

                    //   if (
                    //     category?.discountType === "percent" &&
                    //     category?.value
                    //   ) {
                    //     discounted_total_price =
                    //       entity.price - (entity.price * category.value) / 100;
                    //   } else if (
                    //     category?.discountType === "amount" &&
                    //     category?.value
                    //   ) {
                    //     discounted_total_price =
                    //       entity.price - category.value > 0
                    //         ? entity.price - category.value
                    //         : 0;
                    //   }

                    //   acc.push({
                    //     ...entity,
                    //     discounted_total_price,
                    //   });
                    // }

                    if (
                      entity &&
                      !entity?.outOfStock
                      // &&
                      // entity?.modifiers &&
                      // entity?.modifiers?.length === 0 &&
                      // !entity?.hasVariant
                    ) {
                      let discounted_total_price = entity?.price;

                      if (
                        category?.discountType === "percent" &&
                        category?.value
                      ) {
                        discounted_total_price =
                          entity?.price -
                          (entity?.price * category?.value) / 100;
                      } else if (
                        category?.discountType === "amount" &&
                        category?.value
                      ) {
                        discounted_total_price =
                          entity?.price - category?.value > 0
                            ? entity?.price - category?.value
                            : 0;
                      }

                      if (entity?.hasVariant) {
                        const leastValueVariant: any = {};
                        // let leastValue = entity?.price;
                        let leastValue = entity?.variants?.find(
                          (variant: any) =>
                            !variant?.outOfStock && variant?.isActive,
                        )?.price;

                        entity?.variants?.forEach((variant: any) => {
                          if (
                            !variant?.outOfStock &&
                            variant?.isActive &&
                            variant?.price <= leastValue
                          ) {
                            // leastValueVariant = variant;
                            leastValue = variant?.price;
                          }
                        });

                        // entity?.variants?.forEach((variant: any) => {
                        //   if (
                        //     !variant?.outOfStock &&
                        //     variant?.isActive
                        //     // &&
                        //     // variant?.price <= leastValue
                        //   ) {
                        //     // leastValueVariant = variant;
                        //     // leastValue = variant?.price;

                        //     if (variant && Object.keys(variant).length > 0) {
                        //       var modifierProperties = fetchModifierProperties(
                        //         variant?.modifiers,
                        //         menuModifiers,
                        //       );
                        //       const returnableObject: any = {};
                        //       modifierProperties?.forEach((modifier: any) => {
                        //         if (modifier.isActive) {
                        //           returnableObject[modifier._id] = [];
                        //         }
                        //       });
                        //       let leastValueVariant_discounted_total_price =
                        //       variant?.price;

                        //       if (
                        //         category?.discountType === "percent" &&
                        //         category?.value
                        //       ) {
                        //         leastValueVariant_discounted_total_price =
                        //         variant?.price -
                        //           (variant?.price * category?.value) /
                        //             100;
                        //       } else if (
                        //         category?.discountType === "amount" &&
                        //         category?.value
                        //       ) {
                        //         leastValueVariant_discounted_total_price =
                        //         variant?.price - category?.value > 0
                        //             ? variant?.price - category?.value
                        //             : 0;
                        //       }
                        //       console.log("leastValueVariant", variant);
                        //       acc.push({
                        //         ...entity,
                        //         selectedVariant: {
                        //           ...variant,
                        //           isGetItemCustomized: false,
                        //           isGetItem: true,
                        //           discounted_total_price:
                        //             leastValueVariant_discounted_total_price,
                        //         },
                        //         discounted_total_price: discounted_total_price,
                        //         customizations: returnableObject,
                        //         selectedVariantModifiers:
                        //         variant?.modifiers,
                        //         baseItem: {
                        //           ...entity,
                        //           isGetItemCustomized: false,
                        //           isGetItem: true,
                        //         },
                        //         baseItemPrice: entity?.price,
                        //         variantPrice: variant?.price,
                        //         selectedVariantId: variant?.id,
                        //         isGetItemCustomized: false,
                        //         isGetItem: true,
                        //         type: "VARIANT",
                        //       });
                        //     }
                        //   }
                        // });

                        // const firstInStockAndActiveVariant =
                        //   entity?.variants?.find(
                        //     (variant: any) =>
                        //       !variant?.outOfStock && variant?.isActive,
                        //   );

                        if (leastValue) {
                          acc.push({
                            ...entity,
                            // selectedVariant: {
                            //   ...variant,
                            //   isGetItemCustomized: false,
                            //   isGetItem: true,
                            //   discounted_total_price:
                            //     leastValueVariant_discounted_total_price,
                            // },
                            // discounted_total_price: discounted_total_price,
                            // undiscounted_total_price: entity?.price,
                            // customizations: returnableObject,
                            // selectedVariantModifiers: variant?.modifiers,
                            baseItem: {
                              ...entity,
                              isGetItemCustomized: false,
                              isGetItem: true,
                            },
                            baseItemPrice: entity?.price,
                            // variantPrice: variant?.price,
                            // selectedVariantId: variant?.id,
                            isGetItemCustomized: false,
                            isGetItem: true,
                            type: "VARIANT",
                            discountType: category?.discountType,
                            discountValue: category?.value,
                          });
                        }

                        // console.log("leastValueVariant", leastValueVariant);
                        // this case is valid when we already select leastvaluevariant by default for the category
                        if (
                          leastValueVariant &&
                          Object.keys(leastValueVariant).length > 0
                        ) {
                          const modifierProperties = fetchModifierProperties(
                            leastValueVariant?.modifiers,
                          );
                          const returnableObject: any = {};
                          modifierProperties?.forEach((modifier: any) => {
                            if (modifier?.isActive) {
                              returnableObject[modifier?._id] = [];
                            }
                          });
                          let leastValueVariant_discounted_total_price =
                            leastValueVariant?.price;

                          if (
                            category?.discountType === "percent" &&
                            category?.value
                          ) {
                            leastValueVariant_discounted_total_price =
                              leastValueVariant?.price -
                              (leastValueVariant?.price * category?.value) /
                                100;
                          } else if (
                            category?.discountType === "amount" &&
                            category?.value
                          ) {
                            leastValueVariant_discounted_total_price =
                              leastValueVariant?.price - category?.value > 0
                                ? leastValueVariant?.price - category?.value
                                : 0;
                          }
                          acc.push({
                            ...entity,
                            selectedVariant: {
                              ...leastValueVariant,
                              isGetItemCustomized: false,
                              isGetItem: true,
                              discounted_total_price:
                                leastValueVariant_discounted_total_price,
                            },

                            discounted_total_price: discounted_total_price,
                            customizations: returnableObject,
                            selectedVariantModifiers:
                              leastValueVariant?.modifiers,
                            baseItem: {
                              ...entity,
                              isGetItemCustomized: false,
                              isGetItem: true,
                            },
                            baseItemPrice: entity?.price,
                            variantPrice: leastValueVariant?.price,
                            selectedVariantId: leastValueVariant?.id,
                            isGetItemCustomized: false,
                            isGetItem: true,
                            type: "VARIANT",
                          });
                        }
                      } else {
                        // console.log(
                        //   "firstInStockAndActiveVariantotem",
                        //   category,
                        // );

                        const entityToReturn = {
                          ...entity,
                          discountType: category?.discountType,
                          discountValue: category?.value,
                          isGetItem: true,
                          // discounted_total_price,
                          // undiscounted_total_price: entity?.price,
                          type: entity?.hasVariant
                            ? "VARIANT"
                            : entity?.modifiers && entity?.modifiers?.length > 0
                              ? "CUSTOMIZABLE"
                              : "ITEM",
                        };

                        if (
                          !entity?.hasVariant &&
                          entity?.modifiers &&
                          entity?.modifiers?.length > 0
                        ) {
                          const modifierProperties = fetchModifierProperties(
                            entity?.modifiers,
                          );
                          const returnableObject: any = {};
                          modifierProperties.forEach((modifier: any) => {
                            if (modifier?.isActive) {
                              returnableObject[modifier?._id] = [];
                            }
                          });
                          entityToReturn.customizations = returnableObject;
                          entityToReturn.baseItem = entity;
                          entityToReturn.baseItemPrice = entity?.price;
                        } else {
                          entityToReturn.discounted_total_price =
                            discounted_total_price;
                          entityToReturn.undiscounted_total_price =
                            entity?.price;
                        }

                        acc.push({
                          ...entityToReturn,
                        });
                      }
                    }

                    // console.log("variantEntityvariantEntity", entity);

                    // if (!entity) {
                    //   const variantEntity = variantEntityMap.get(itemId);

                    //   console.log("variantEntity", variantEntity);

                    //   if (variantEntity && variantEntity?.length > 0) {
                    //     const availableBaseEntities = variantEntity?.reduce(
                    //       (varacc: any, variant: any) => {
                    //         if (
                    //           variant &&
                    //           !variant?.outOfStock &&
                    //           variant?.modifiers &&
                    //           variant?.hasVariant
                    //         ) {
                    //           let discounted_total_price = variant?.price;

                    //           if (category?.discountType === "percent" && category?.value) {
                    //             discounted_total_price =
                    //               variant?.price - (variant?.price * category?.value) / 100;
                    //           } else if (
                    //             category?.discountType === "amount" &&
                    //             category?.value
                    //           ) {
                    //             discounted_total_price =
                    //               variant?.price - category?.value > 0
                    //                 ? variant?.price - category?.value
                    //                 : 0;
                    //           }

                    //           console.log("variantvariant", variant, itemId);

                    //           const selectedVariant = variant?.variants?.find(
                    //             (v: any) => v.id === itemId,
                    //           );

                    //           varacc.push({
                    //             ...variant,
                    //             discounted_total_price,
                    //             selectedVariant: {
                    //               ...selectedVariant,
                    //               isGetItemCustomized: false,
                    //               isGetItem: true,
                    //             },
                    //             selectedVariantId: itemId,
                    //             customizations: {},
                    //             selectedVariantModifiers: selectedVariant?.modifiers,
                    //             type: "VARIANT",
                    //             baseItem: {
                    //               ...variant,
                    //               isGetItemCustomized: false,
                    //               isGetItem: true,
                    //             },
                    //             baseItemPrice: variant?.price,
                    //             variantPrice: selectedVariant?.price,
                    //             isGetItemCustomized: false,
                    //           });
                    //         }
                    //         return varacc;
                    //       },
                    //       [],
                    //     );
                    //     acc.push( {
                    //       ...category,
                    //       entities: availableBaseEntities,
                    //     });
                    //   }
                    // }
                    // return {
                    //   ...category,
                    //   entities: {},
                    // };
                    return acc;
                  },
                  [],
                );

                // console.log("availableEntities", availableEntities, entities);

                if (availableEntities.length > 0) {
                  return {
                    ...category,
                    entities: availableEntities,
                  };
                }
              }
              return {
                ...category,
                entities: [],
              };
            },
          );
        }
      }

      if (
        offer?.applicable?.rawItems &&
        offer?.applicable?.rawItems.length > 0
      ) {
        let isBuyAnd = false;
        updatedOffer.applicable.rawItems = updatedOffer.applicable.rawItems.map(
          (rawItem: any) => {
            let isRawItemAvailable = false;
            const rawItemRelation = rawItem?.relation;
            if (rawItemRelation === "and") {
              isBuyAnd = true;
            }
            if (rawItem?.item && Object.keys(rawItem?.item)?.length > 0) {
              const entity = entityMap.get(rawItem?.item.baseItemId);
              if (entity && !entity?.outOfStock) {
                isRawItemAvailable = true;
              } else {
                const variantEntity = variantEntityMap.get(
                  rawItem?.item.baseItemId,
                );
                if (variantEntity && variantEntity?.length > 0) {
                  const availableBaseVaraint = variantEntity?.find(
                    (variant: any) =>
                      !variant?.outOfStock &&
                      variant?.modifiers &&
                      variant?.hasVariant,
                  );
                  if (availableBaseVaraint) {
                    isRawItemAvailable = true;
                  }
                }
              }
            } else if (
              rawItem?.category &&
              Object.keys(rawItem?.category)?.length > 0
            ) {
              const entities: any = [];

              if (categoryMap.get(rawItem.category?._id)) {
                const categoryMapObject = categoryMap.get(
                  rawItem.category?._id,
                );
                // create array from object values
                Object.values(categoryMapObject).forEach((value: any) => {
                  entities.push(value);
                });
              }
              if (
                entities &&
                entities.length > 0 &&
                entities?.find((e: any) => !e?.outOfStock)
              ) {
                isRawItemAvailable = true;
              }
            }
            return {
              ...rawItem,
              isRawItemAvailable: isRawItemAvailable,
            };
          },
        );
        updatedOffer.isBuyAndOffer = isBuyAnd;
      }
      return updatedOffer;
    });
    // console.log("convertedOffers by menu", updatedOffers);
    dispatch(setFilteredOffers(updatedOffers));
  };

  return {
    converOffersForGetItemByMenu,
  };
};
export default useOfferConverters;
